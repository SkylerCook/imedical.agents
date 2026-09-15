"""Framework-maintained SFTP operations. Importing this module never connects."""
import fnmatch
import hashlib
import os
import posixpath
import shlex
import stat
import time
import uuid


def ignored(relative, patterns):
    relative = relative.replace("\\", "/").strip("/")
    for pattern in patterns:
        pattern = pattern.replace("\\", "/")
        if pattern.endswith("/"):
            directory = pattern.rstrip("/")
            if any(fnmatch.fnmatchcase(part, directory) for part in relative.split("/")):
                return True
            if fnmatch.fnmatchcase(relative + "/", directory + "/*"):
                return True
        elif fnmatch.fnmatchcase(relative, pattern) or fnmatch.fnmatchcase(relative.split("/")[-1], pattern):
            return True
    return False


def integer(value, name, minimum=0, maximum=None):
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise ValueError(f"Invalid {name}")
    return value


class Operations:
    def __init__(self, local_root, remote_root, patterns, get_sftp, get_ssh, allow_commands=False):
        self.local_root = os.path.realpath(local_root) if local_root else ""
        self.remote_root = self.remote_path(remote_root) if remote_root else ""
        self.patterns = patterns
        self.get_sftp = get_sftp
        self.get_ssh = get_ssh
        self.allow_commands = allow_commands

    @staticmethod
    def remote_path(value):
        if not isinstance(value, str) or not value.startswith("/") or "\\" in value or "\x00" in value:
            raise ValueError("Remote path must be absolute POSIX syntax")
        if ".." in value.split("/"):
            raise ValueError("Remote parent traversal is forbidden")
        return posixpath.normpath(value)

    def local(self, value, directory=False):
        if not self.local_root:
            raise ValueError("LOCAL_PATH is required")
        value = os.path.realpath(value or self.local_root)
        if os.path.commonpath([value, self.local_root]) != self.local_root:
            raise ValueError("Local path escapes LOCAL_PATH")
        if not (os.path.isdir(value) if directory else os.path.isfile(value)):
            raise ValueError("Local source does not exist or has wrong type")
        return value

    def remote(self, value):
        if not self.remote_root:
            raise ValueError("REMOTE_PATH is required")
        value = self.remote_path(value or self.remote_root)
        if posixpath.commonpath([value, self.remote_root]) != self.remote_root:
            raise ValueError("Remote path escapes REMOTE_PATH")
        return value

    def check_remote(self, sftp, value):
        # Reject symlinks in every existing component, including the configured root.
        current = "/"
        for part in value.strip("/").split("/"):
            if not part:
                continue
            current = posixpath.join(current, part)
            try:
                attr = sftp.lstat(current)
            except FileNotFoundError:
                break
            if stat.S_ISLNK(attr.st_mode):
                raise ValueError("Remote symbolic links are forbidden")
            if current != value and not stat.S_ISDIR(attr.st_mode):
                raise ValueError("Remote parent is not a directory")

    def ensure_dir(self, sftp, value, created):
        self.check_remote(sftp, value)
        if value == "/":
            return
        try:
            attr = sftp.stat(value)
        except FileNotFoundError:
            if posixpath.commonpath([value, self.remote_root]) != self.remote_root:
                raise ValueError("Ancestors of REMOTE_PATH must already exist")
            self.ensure_dir(sftp, posixpath.dirname(value), created)
            try:
                sftp.mkdir(value)
                created.append(value)
            except OSError:
                # Only tolerate a concurrent creator, never swallow permission errors.
                attr = sftp.lstat(value)
                if not stat.S_ISDIR(attr.st_mode):
                    raise ValueError("Remote parent is not a directory")
        else:
            if not stat.S_ISDIR(attr.st_mode):
                raise ValueError("Remote parent is not a directory")

    @staticmethod
    def digest(stream):
        result = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            result.update(chunk)
        return result.hexdigest()

    def transfer(self, sftp, source, target):
        self.check_remote(sftp, target)
        try:
            previous = sftp.lstat(target)
            if not stat.S_ISREG(previous.st_mode):
                raise ValueError("Remote destination is not a regular file")
        except FileNotFoundError:
            previous = None
        temporary = target + ".imedical-" + uuid.uuid4().hex + ".tmp"
        owned = False
        try:
            before = os.stat(source)
            # Exclusive creation prevents overwriting someone else's temporary file.
            with sftp.file(temporary, "wx") as output:
                owned = True
                with open(source, "rb") as data:
                    digest = hashlib.sha256()
                    while chunk := data.read(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
            after = os.stat(source)
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError("Local file changed during upload")
            with sftp.file(temporary, "rb") as data:
                if self.digest(data) != digest.hexdigest():
                    raise ValueError("Remote SHA-256 verification failed")
            sftp.utime(temporary, (int(before.st_atime), int(before.st_mtime)))
            if previous:
                sftp.chmod(temporary, stat.S_IMODE(previous.st_mode))
            self.check_remote(sftp, target)
            # Requires OpenSSH posix-rename; no delete-then-rename/direct-write fallback.
            sftp.posix_rename(temporary, target)
            owned = False
            return {"status": "uploaded", "size": before.st_size, "sha256": digest.hexdigest()}
        finally:
            if owned:
                # Remove only this call's exclusively created temporary path.
                try:
                    sftp.remove(temporary)
                except FileNotFoundError:
                    pass  # A completed rename may have lost its response; never retry the write.

    def upload(self, args):
        source = self.local(args["local_file_path"])
        relative = os.path.relpath(source, self.local_root).replace("\\", "/")
        target = self.remote(args.get("remote_file_path") or posixpath.join(self.remote_root, relative))
        if target == self.remote_root:
            raise ValueError("Upload target must be a file below REMOTE_PATH")
        sftp = self.get_sftp()
        created = []
        self.ensure_dir(sftp, posixpath.dirname(target), created)
        return dict(self.transfer(sftp, source, target), local_path=source, remote_path=target, created_dirs=created)

    def sync(self, args):
        local = self.local(args.get("local_dir"), directory=True)
        remote = self.remote(args.get("remote_dir"))
        strategy = args.get("compare", "sha256")
        if strategy not in ("sha256", "mtime-size", "always"):
            raise ValueError("Invalid compare strategy")
        dry_run = args.get("dry_run", False)
        if type(dry_run) is not bool:
            raise ValueError("dry_run must be boolean")
        # Collect and validate every local candidate before starting writes.
        candidates, skipped = [], []
        def linklike(value):
            return os.path.islink(value) or bool(getattr(os.lstat(value), 'st_file_attributes', 0) & 0x400)

        for root, dirs, files in os.walk(local, followlinks=False):
            for directory in list(dirs):
                full = os.path.join(root, directory)
                rel = os.path.relpath(full, local)
                if linklike(full) or ignored(rel, self.patterns):
                    dirs.remove(directory)
                    skipped.append(rel)
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, local)
                if linklike(full) or ignored(rel, self.patterns):
                    skipped.append(rel)
                    continue
                source = self.local(full)
                target = self.remote(posixpath.join(remote, rel.replace("\\", "/")))
                candidates.append((rel, source, target))
        sftp = self.get_sftp()
        for _, _, target in candidates:
            self.check_remote(sftp, target)
        result = {"status": "planned" if dry_run else "completed", "uploaded": [], "planned": [],
                  "unchanged": [], "ignored": skipped, "created_dirs": [], "errors": []}
        for rel, source, target in candidates:
            try:
                upload = True
                try:
                    attr = sftp.stat(target)
                    if not stat.S_ISREG(attr.st_mode):
                        raise ValueError("Remote destination is not a regular file")
                    local_attr = os.stat(source)
                    if strategy == "mtime-size":
                        upload = attr.st_size != local_attr.st_size or int(local_attr.st_mtime) != attr.st_mtime
                    elif strategy == "sha256" and attr.st_size == local_attr.st_size:
                        with open(source, "rb") as left, sftp.file(target, "rb") as right:
                            upload = self.digest(left) != self.digest(right)
                except FileNotFoundError:
                    pass
                if not upload:
                    result["unchanged"].append(rel)
                elif dry_run:
                    result["planned"].append(rel)
                else:
                    self.ensure_dir(sftp, posixpath.dirname(target), result["created_dirs"])
                    result["uploaded"].append(dict(self.transfer(sftp, source, target), path=rel))
            except Exception as error:
                result["errors"].append({"path": rel, "error": str(error)})
        if result["errors"]:
            result["status"] = "partial-failure"
        return result

    def read(self, args):
        target = self.remote(args["remote_file_path"])
        maximum = integer(args.get("max_size", 5242880), "max_size", 1, 16777216)
        offset = integer(args.get("offset", 0), "offset")
        limit = integer(args.get("limit", 0), "limit")
        sftp = self.get_sftp()
        self.check_remote(sftp, target)
        size = sftp.stat(target).st_size
        if offset > size:
            raise ValueError("offset exceeds file size")
        count = min(size - offset, limit) if limit else size - offset
        if count > maximum:
            raise ValueError("Requested read exceeds max_size; use offset/limit")
        with sftp.file(target, "rb") as data:
            data.seek(offset)
            content = data.read(count)
        encoding = args.get("encoding", "utf-8")
        return {"path": target, "content": content.decode(encoding, errors="replace"),
                "total_size": size, "offset": offset, "read_bytes": len(content), "encoding": encoding}

    def list_dir(self, args):
        target = self.remote(args["remote_dir_path"])
        sftp = self.get_sftp()
        self.check_remote(sftp, target)
        return {"path": target, "items": [
            {"name": a.filename, "size": a.st_size, "permissions": oct(a.st_mode), "mtime": a.st_mtime,
             "type": "directory" if stat.S_ISDIR(a.st_mode) else "symlink" if stat.S_ISLNK(a.st_mode) else "file"}
            for a in sftp.listdir_attr(target)]}

    def execute(self, args):
        if not self.allow_commands:
            raise ValueError("SSH commands disabled; explicitly configure ALLOW_REMOTE_COMMANDS=true")
        command = args["command"]
        if not isinstance(command, str) or not command.strip():
            raise ValueError("command is required")
        if args.get("working_directory"):
            command = "cd " + shlex.quote(self.remote(args["working_directory"])) + " && " + command
        timeout = integer(args.get("timeout", 120), "timeout", 1, 600)
        deadline = time.monotonic() + timeout
        stdin, stdout, stderr = self.get_ssh().exec_command(command, timeout=timeout)
        channel = stdout.channel
        out, err = bytearray(), bytearray()
        try:
            stdin.close()
            while True:
                # Bound each iteration so a continuous producer cannot starve deadline checks.
                if channel.recv_ready():
                    out.extend(channel.recv(65536))
                if channel.recv_stderr_ready():
                    err.extend(channel.recv_stderr(65536))
                if len(out) + len(err) > 8 * 1024 * 1024:
                    raise ValueError("Command output exceeds 8 MiB")
                if time.monotonic() >= deadline:
                    raise TimeoutError("Command deadline exceeded; remote process may still be running")
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    break
                time.sleep(0.01)
            return {"exit_code": channel.recv_exit_status(), "stdout": out.decode("utf-8", "replace"),
                    "stderr": err.decode("utf-8", "replace")}
        finally:
            channel.close()
            stdout.close()
            stderr.close()
