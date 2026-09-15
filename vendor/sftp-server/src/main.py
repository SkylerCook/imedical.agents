"""SFTP MCP server maintained by imedical.agents (stdio, no startup network access)."""
import asyncio
import base64
import hashlib
import hmac
import re
import json
import os
import sys
from importlib.metadata import version

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, Resource, TextContent, Tool
import paramiko

from operations import Operations


def local_path(value):
    root = os.environ.get("CODEX_WORKSPACE") or os.environ.get("WORKSPACE_FOLDER") or os.getcwd()
    for token in ("__PROJECT_ROOT__", "${workspaceFolder}", "${cwd}"):
        value = value.replace(token, root)
    return os.path.abspath(os.path.expandvars(os.path.expanduser(value))) if value else ""


class FingerprintPolicy(paramiko.MissingHostKeyPolicy):
    """Explicit, nonpersistent trust for exactly one caller-supplied key digest."""
    def __init__(self, fingerprint):
        if not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", fingerprint):
            raise ValueError("Invalid TARGET_HOST_KEY_SHA256")
        self.fingerprint = fingerprint

    def missing_host_key(self, client, hostname, key):
        actual = "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
        if not hmac.compare_digest(actual, self.fingerprint):
            raise paramiko.SSHException("Host key fingerprint mismatch")


class Connection:
    def __init__(self):
        self.ssh = self.sftp = None

    def close(self):
        for client in (self.sftp, self.ssh):
            if client:
                try:
                    client.close()
                except Exception:
                    pass
        self.ssh = self.sftp = None

    def get_ssh(self):
        transport = self.ssh.get_transport() if self.ssh else None
        if transport and transport.is_active() and transport.is_authenticated():
            return self.ssh
        self.close()
        host, user = os.getenv("TARGET_HOST"), os.getenv("TARGET_USERNAME")
        if not host or not user:
            raise ValueError("TARGET_HOST and TARGET_USERNAME are required")
        client = paramiko.SSHClient()
        try:
            fingerprint = os.getenv("TARGET_HOST_KEY_SHA256")
            known_hosts = os.getenv("TARGET_KNOWN_HOSTS")
            if fingerprint and known_hosts:
                raise ValueError("Choose a known_hosts file or a fingerprint")
            if fingerprint:
                client.set_missing_host_key_policy(FingerprintPolicy(fingerprint))
            else:
                if known_hosts:
                    client.load_host_keys(local_path(known_hosts))
                else:
                    client.load_system_host_keys()
                client.set_missing_host_key_policy(paramiko.RejectPolicy())
            client.connect(hostname=host, port=int(os.getenv("TARGET_PORT", "22")), username=user,
                           password=os.getenv("TARGET_PASSWORD") or None,
                           key_filename=local_path(os.getenv("TARGET_KEY_FILE", "")) or None,
                           look_for_keys=False, allow_agent=False, timeout=30, auth_timeout=30, banner_timeout=30)
            client.get_transport().set_keepalive(30)
        except Exception:
            client.close()
            raise
        self.ssh = client
        return client

    def get_sftp(self):
        ssh = self.get_ssh()
        if self.sftp and not self.sftp.get_channel().closed:
            return self.sftp
        if self.sftp:
            self.sftp.close()
        self.sftp = ssh.open_sftp()
        self.sftp.get_channel().settimeout(30)
        return self.sftp


connection = Connection()
server = Server("sftp-mcp-server")
lock = asyncio.Lock()


def operations():
    patterns = json.loads(os.getenv("IGNORE_PATTERNS", '[".git/", "node_modules/", ".vscode/"]'))
    if not isinstance(patterns, list) or any(not isinstance(p, str) or not p for p in patterns):
        raise ValueError("IGNORE_PATTERNS must be a JSON array of nonempty strings")
    return Operations(local_path(os.getenv("LOCAL_PATH", "")), os.getenv("REMOTE_PATH", ""), patterns,
                      connection.get_sftp, connection.get_ssh, os.getenv("ALLOW_REMOTE_COMMANDS") == "true")


def string(description):
    return {"type": "string", "description": description}


@server.list_tools()
async def list_tools():
    definitions = [
        ("sync_directory", "Synchronize files within configured roots; no deletions. Default SHA-256 comparison.", {
            "local_dir": string("Local directory, defaults to LOCAL_PATH"),
            "remote_dir": string("Remote directory, defaults to REMOTE_PATH"),
            "compare": {"type": "string", "enum": ["sha256", "mtime-size", "always"], "default": "sha256"},
            "dry_run": {"type": "boolean", "default": False}}, []),
        ("upload_file", "Upload, verify SHA-256 and atomically replace one remote file; requires posix-rename.", {
            "local_file_path": string("Local file inside LOCAL_PATH"),
            "remote_file_path": string("Remote destination inside REMOTE_PATH; otherwise mapped from source")}, ["local_file_path"]),
        ("read_remote_file", "Read a bounded byte range within REMOTE_PATH.", {
            "remote_file_path": string("Remote file"), "encoding": string("Text encoding, defaults to utf-8"),
            "max_size": {"type": "integer", "minimum": 1, "maximum": 16777216, "default": 5242880},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
            "limit": {"type": "integer", "minimum": 0, "default": 0}}, ["remote_file_path"]),
        ("execute_remote_command", "Execute explicitly authorized SSH command; disabled unless ALLOW_REMOTE_COMMANDS=true. POSIX shell required.", {
            "command": string("Shell command; this tool is not restricted to SFTP roots"),
            "working_directory": string("Optional POSIX directory within REMOTE_PATH"),
            "timeout": {"type": "integer", "minimum": 1, "maximum": 600, "default": 120}}, ["command"]),
        ("list_remote_directory", "List directory within REMOTE_PATH.", {
            "remote_dir_path": string("Remote directory")}, ["remote_dir_path"]),
    ]
    return [Tool(name=name, description=description, inputSchema={"type": "object", "properties": properties,
                 "required": required, "additionalProperties": False})
            for name, description, properties, required in definitions]


def dispatch(name, arguments):
    handlers = {"sync_directory": "sync", "upload_file": "upload", "read_remote_file": "read",
                "execute_remote_command": "execute", "list_remote_directory": "list_dir"}
    if name not in handlers:
        raise ValueError("Unknown tool")
    return getattr(operations(), handlers[name])(arguments)


@server.call_tool()
async def call_tool(name, arguments):
    async with lock:
        try:
            # Serialize the shared Paramiko session without blocking the MCP event loop.
            task = asyncio.create_task(asyncio.to_thread(dispatch, name, arguments))
            try:
                result = await asyncio.shield(task)
            except asyncio.CancelledError:
                await task  # Keep the connection lock until a started write actually completes.
                raise
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
                                  isError=bool(result.get("errors")) or result.get("exit_code", 0) != 0)
        except Exception as error:
            connection.close()
            message = str(error)
            if os.getenv("TARGET_PASSWORD"):
                message = message.replace(os.environ["TARGET_PASSWORD"], "[redacted]")
            return CallToolResult(content=[TextContent(type="text", text=json.dumps({"error": message}))], isError=True)


@server.list_resources()
async def list_resources():
    return [Resource(uri="sftp://config", name="SFTP Configuration", mimeType="application/json")]


@server.read_resource()
async def read_resource(uri):
    if str(uri).rstrip("/") != "sftp://config":
        raise ValueError("Unknown resource")
    operations()
    return json.dumps({"configured": all(os.getenv(k) for k in ("TARGET_HOST", "TARGET_USERNAME", "LOCAL_PATH", "REMOTE_PATH")),
                       "hostKeyPolicy": "explicit-sha256-pin" if os.getenv("TARGET_HOST_KEY_SHA256") else "reject-unknown", "atomicUpload": "posix-rename-required",
                       "remoteCommandsEnabled": os.getenv("ALLOW_REMOTE_COMMANDS") == "true"})


async def main():
    try:
        async with stdio_server() as (reader, writer):
            await server.run(reader, writer, server.create_initialization_options())
    finally:
        connection.close()


def cli():
    if "--check" in sys.argv:
        print(json.dumps({"status": "ready", "python": sys.version.split()[0],
                          "mcp": version("mcp"), "paramiko": version("paramiko"), "network": "not-contacted"}))
    else:
        asyncio.run(main())


if __name__ == "__main__":
    cli()
