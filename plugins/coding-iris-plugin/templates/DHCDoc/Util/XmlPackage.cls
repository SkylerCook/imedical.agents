/// Name: 受控 XML 导出
/// Description: 只使用 IRIS 标准类。Dispatch 与无预部署类的执行通道使用同一实现；安装 XML 必须经目标 IRIS 编译与原生 Export 生成。
Class DHCDoc.Util.XmlPackage Extends %RegisteredObject
{

/// Name: 受限任务操作
/// Description: 接收 Base64 UTF-8 JSON，仅支持 info、project、export、inspect、read、cleanup；不提供任意文件读取或导入。
/// Param: payload | Base64 编码的任务请求，包含实际 namespace、runId、scopeHash 和私有 token。
/// Return: 单个 JSON 回执。code 非零或状态 unknown 均不得当作完整导出成功。
ClassMethod Dispatch(payload As %String) As %String [ SqlProc ]
{
    // BEGIN IRIS XML SHARED DISPATCH
    s result = {"schema":"iris-xml-remote/v1","code":-1}
    s heldLock = 0
    try {
        s request = {}.%FromJSON($zcvt($system.Encryption.Base64Decode(payload), "I", "UTF8"))
        s result.namespace = $namespace
        if ((request.%Get("namespace") = "") || (request.namespace '= $namespace)) {
            throw ##class(%Exception.General).%New("xml-namespace-mismatch")
        }
        s operation = request.operation
        if ('$listfind($listbuild("info", "project", "export", "inspect", "read", "cleanup"), operation)) {
            throw ##class(%Exception.General).%New("xml-operation-invalid")
        }
        s result.operation = operation
        s result.webApplication = request.%Get("webApplication")
        if (request.%Get("webApplication") '= "") {
            s originalNamespace = $namespace
            try {
                zn "%SYS"
                s sc = ##class(Security.Applications).Get(request.webApplication, .applicationProperties)
                zn originalNamespace
            } catch mappingError {
                zn originalNamespace
                throw mappingError
            }
            if ('$system.Status.IsOK(sc)) {
                throw ##class(%Exception.General).%New("xml-web-mapping-unreadable")
            }
            if ($zcvt($g(applicationProperties("NameSpace")), "U") '= $zcvt(request.namespace, "U")) {
                throw ##class(%Exception.General).%New("xml-web-namespace-mismatch")
            }
            s result.webMappingVerified = 1
        }
        if (operation = "info") {
            s result.protocol = "iris-xml-dispatch/v1"
            s result.formats = ["iris", "cache"]
            s result.operations = ["export", "inspect", "read", "cleanup", "project"]
            s result.code = 0
        } elseif (operation = "project") {
            if ((request.%Get("project") = "") || ($length(request.project) > 255)) {
                throw ##class(%Exception.General).%New("xml-project-invalid")
            }
            s rs = ##class(%ResultSet).%New("%Studio.Project:ProjectItemsList")
            s sc = rs.Execute(request.project)
            if ('$system.Status.IsOK(sc)) {
                throw ##class(%Exception.General).%New("xml-project-unreadable")
            }
            s result.items = []
            while (rs.Next()) {
                s item = {}
                s item.name = rs.Get("Name")
                s item.type = rs.Get("Type")
                d result.items.%Push(item)
            }
            d rs.Close()
            s result.code = 0
        } else {
            s runId = request.%Get("runId")
            s token = request.%Get("token")
            if (($length(runId) '= 36) || ($tr(runId, "0123456789abcdef-", "") '= "")) {
                throw ##class(%Exception.General).%New("xml-run-id-invalid")
            }
            if (($length(token) '= 64) || ($tr(token, "0123456789abcdef", "") '= "")) {
                throw ##class(%Exception.General).%New("xml-task-token-invalid")
            }
            if (($length(request.scopeHash) '= 64) || ($tr(request.scopeHash, "0123456789abcdef", "") '= "")) {
                throw ##class(%Exception.General).%New("xml-scope-hash-invalid")
            }
            s rootInput = $tr(request.%Get("root"), "\", "/")
            if ((rootInput = "") || ($length(rootInput) > 2000) || (rootInput [ "..") || (rootInput [ $c(0))) {
                throw ##class(%Exception.General).%New("xml-task-root-invalid")
            }
            if (($extract(rootInput) '= "/") && ($extract(rootInput, 2, 3) '= ":/")) {
                throw ##class(%Exception.General).%New("xml-task-root-not-absolute")
            }
            s root = ##class(%File).NormalizeDirectory(rootInput)
            s taskDirectory = ##class(%File).NormalizeDirectory(root _ runId)
            s markerPath = taskDirectory _ "request.json"
            s result.runId = runId
            s result.scopeHash = request.scopeHash
            lock +^IRISXmlExportTask(runId):0
            if ('$test) {
                throw ##class(%Exception.General).%New("xml-task-busy")
            }
            s heldLock = 1
            if (operation = "export") {
                if (##class(%File).DirectoryExists(taskDirectory)) {
                    throw ##class(%Exception.General).%New("xml-task-exists-inspect-before-retry")
                }
                if ('$isobject(request.documents) || (request.documents.%Size() < 1) || (request.documents.%Size() > 10000)) {
                    throw ##class(%Exception.General).%New("xml-documents-invalid")
                }
                s count = request.documents.%Size()
                s exportList = ""
                for index = 0:1:count-1 {
                    s document = request.documents.%Get(index)
                    if ((document = "") || ($length(document) > 1000) || (document [ ",") || (document [ ";") || (document [ "*") || (document [ "?") || (document [ "'") || (document [ "\") || (document [ "..") || (document [ $c(0))) {
                        throw ##class(%Exception.General).%New("xml-document-invalid")
                    }
                    if (document [ "/") {
                        s app = request.%Get("webApplication")
                        if ((app = "") || ($extract("/" _ document, 1, $length(app) + 1) '= (app _ "/"))) {
                            throw ##class(%Exception.General).%New("xml-web-application-required")
                        }
                        s document = "/" _ document
                    } else {
                        if ($tr(document, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.%", "") '= "") {
                            throw ##class(%Exception.General).%New("xml-backend-document-invalid")
                        }
                        s extension = $zcvt($piece(document, ".", *), "L")
                        if ('$listfind($listbuild("cls", "mac", "inc", "int"), extension)) {
                            throw ##class(%Exception.General).%New("xml-document-type-invalid")
                        }
                    }
                    s documents(index) = document
                    s exportList = exportList _ $select(index = 0: "", 1: ",") _ document
                }
                if ('$listfind($listbuild("iris", "cache"), request.format)) {
                    throw ##class(%Exception.General).%New("xml-format-invalid")
                }
                s sc = ##class(%File).CreateDirectoryChain(taskDirectory)
                if ('$system.Status.IsOK(sc)) {
                    throw ##class(%Exception.General).%New("xml-task-directory-create-failed")
                }
                // Immutable registration precedes Export. A lost response is recovered by inspect, never by replay.
                s registration = request
                s registration.fileCount = $select(request.merge: 1, 1: count)
                s registration.phase = "registered"
                s stream = ##class(%Stream.FileCharacter).%New()
                s stream.TranslateTable = "UTF8"
                s stream.Filename = markerPath _ ".part"
                s sc = stream.Write(registration.%ToJSON())
                if ('$system.Status.IsOK(sc)) {
                    throw ##class(%Exception.General).%New("xml-task-register-write-failed")
                }
                s sc = stream.Flush()
                s stream = ""
                if ('$system.Status.IsOK(sc) || '##class(%File).Rename(markerPath _ ".part", markerPath)) {
                    throw ##class(%Exception.General).%New("xml-task-register-failed")
                }
                s stream = ##class(%Stream.FileCharacter).%New()
                s stream.TranslateTable = "UTF8"
                s stream.Filename = markerPath
                s registered = {}.%FromJSON(stream)
                s stream = ""
                if ((registered.token '= token) || (registered.scopeHash '= request.scopeHash)) {
                    throw ##class(%Exception.General).%New("xml-task-register-readback-failed")
                }
                s qspec = "/recursive=0" _ $select(request.format = "cache": "/exportversion=2016.2", 1: "")
                s outcomes = []
                for index = 0:1:registration.fileCount-1 {
                    s filePath = taskDirectory _ "package-" _ index _ ".xml"
                    s items = $select(request.merge: exportList, 1: documents(index))
                    s sc = $system.OBJ.Export(items, filePath, qspec, .exportLog, "UTF8")
                    s outcome = {}
                    s outcome.id = index
                    s outcome.exportOk = $system.Status.IsOK(sc)
                    d outcomes.%Push(outcome)
                }
                s result.outcomes = outcomes
                s completed = {}
                s completed.outcomes = outcomes
                s stream = ##class(%Stream.FileCharacter).%New()
                s stream.TranslateTable = "UTF8"
                s stream.Filename = taskDirectory _ "outcomes.json.part"
                s sc = stream.Write(completed.%ToJSON())
                if ('$system.Status.IsOK(sc)) {
                    throw ##class(%Exception.General).%New("xml-outcomes-write-failed")
                }
                s sc = stream.Flush()
                s stream = ""
                if ('$system.Status.IsOK(sc) || '##class(%File).Rename(taskDirectory _ "outcomes.json.part", taskDirectory _ "outcomes.json")) {
                    throw ##class(%Exception.General).%New("xml-outcomes-save-failed")
                }
            } else {
                if ('##class(%File).Exists(markerPath)) {
                    if ((operation = "cleanup") && ('##class(%File).DirectoryExists(taskDirectory))) {
                        s result.code = 0
                        s result.cleanupVerified = 1
                    } else {
                        throw ##class(%Exception.General).%New("xml-task-registration-missing")
                    }
                } else {
                    s stream = ##class(%Stream.FileCharacter).%New()
                    s stream.TranslateTable = "UTF8"
                    s stream.Filename = markerPath
                    s registration = {}.%FromJSON(stream)
                    s stream = ""
                    if ((registration.token '= token) || (registration.runId '= runId) || (registration.namespace '= $namespace) || (registration.scopeHash '= request.scopeHash) || (registration.fileCount < 1) || (registration.fileCount > 10000)) {
                        throw ##class(%Exception.General).%New("xml-task-identity-mismatch")
                    }
                }
            }
            if ($isobject($g(registration))) {
                if ((operation '= "read") && (operation '= "cleanup") && ##class(%File).Exists(taskDirectory _ "outcomes.json")) {
                    s stream = ##class(%Stream.FileCharacter).%New()
                    s stream.TranslateTable = "UTF8"
                    s stream.Filename = taskDirectory _ "outcomes.json"
                    s completed = {}.%FromJSON(stream)
                    s stream = ""
                    s result.outcomes = completed.outcomes
                    s result.exportOutcome = "recorded"
                } else {
                    s result.exportOutcome = "unknown"
                }
                if (operation = "read") {
                    s index = +request.fileId
                    s offset = +request.offset
                    s length = +request.length
                    if ((index < 0) || (index >= registration.fileCount) || (index '= request.fileId) || (offset < 0) || (offset '= request.offset) || ((offset \ 1) '= offset) || (length < 1) || (length > 32768) || ((length \ 1) '= length)) {
                        throw ##class(%Exception.General).%New("xml-chunk-range-invalid")
                    }
                    s filePath = taskDirectory _ "package-" _ index _ ".xml"
                    if ('##class(%File).Exists(filePath)) {
                        throw ##class(%Exception.General).%New("xml-package-missing")
                    }
                    s stream = ##class(%Stream.FileBinary).%New()
                    s stream.Filename = filePath
                    s total = stream.Size
                    // MoveTo returns %Boolean, and its positions are one-based. Read returns a separate %Status.
                    if ((offset >= total) || ('stream.MoveTo(offset + 1))) {
                        throw ##class(%Exception.General).%New("xml-chunk-offset-invalid")
                    }
                    s chunk = stream.Read(.length, .sc)
                    if ('$system.Status.IsOK(sc)) {
                        throw ##class(%Exception.General).%New("xml-chunk-read-failed")
                    }
                    s result.fileId = index
                    s result.offset = offset
                    s result.bytes = $length(chunk)
                    s result.total = total
                    s result.eof = ((offset + $length(chunk)) = total)
                    s result.base64 = $system.Encryption.Base64Encode(chunk, 1)
                    s result.sha256 = $zcvt($system.Encryption.ToHex($system.Encryption.SHAHash(256, chunk)), "L")
                    s stream = ""
                    s result.code = 0
                } elseif (operation = "cleanup") {
                    for index = 0:1:registration.fileCount-1 {
                        s filePath = taskDirectory _ "package-" _ index _ ".xml"
                        if (##class(%File).Exists(filePath) && ('##class(%File).Delete(filePath))) {
                            throw ##class(%Exception.General).%New("xml-cleanup-file-failed")
                        }
                    }
                    // Keep ownership until every known payload has been removed. Never recursively delete.
                    for extraIndex = 1:1:2 {
                        s extraPath = taskDirectory _ $select(extraIndex = 1: "outcomes.json", 1: "outcomes.json.part")
                        if (##class(%File).Exists(extraPath) && ('##class(%File).Delete(extraPath))) {
                            throw ##class(%Exception.General).%New("xml-cleanup-receipt-failed")
                        }
                    }
                    if ('##class(%File).Delete(markerPath)) {
                        throw ##class(%Exception.General).%New("xml-cleanup-marker-failed")
                    }
                    s result.cleanupVerified = ##class(%File).RemoveDirectory(taskDirectory)
                    s result.code = $select(result.cleanupVerified: 0, 1: -1)
                } else {
                    s result.files = []
                    for index = 0:1:registration.fileCount-1 {
                        s file = {}
                        s file.id = index
                        s file.name = "package-" _ index _ ".xml"
                        s filePath = taskDirectory _ file.name
                        s file.present = ##class(%File).Exists(filePath)
                        if (file.present) {
                            s stream = ##class(%Stream.FileBinary).%New()
                            s stream.Filename = filePath
                            s file.bytes = stream.Size
                            s file.sha256 = $zcvt($system.Encryption.ToHex($system.Encryption.SHAHashStream(256, stream, .sc)), "L")
                            s stream = ""
                            if ('$system.Status.IsOK(sc)) {
                                throw ##class(%Exception.General).%New("xml-package-hash-failed")
                            }
                        }
                        d result.files.%Push(file)
                    }
                    s result.phase = "observed"
                    s result.code = 0
                }
            }
        }
    } catch error {
        s result.code = -1
        s result.reason = error.Name
    }
    if (heldLock) {
        lock -^IRISXmlExportTask(runId)
    }
    // END IRIS XML SHARED DISPATCH
    q result.%ToJSON()
}

/// Name: 查询协议能力
/// Param: expectedNamespace | 调用方明确选择的 namespace，必须与实际运行环境一致。
/// Return: 与 Dispatch(info) 相同的能力回执；不创建目录。
ClassMethod GetExportInfo(expectedNamespace As %String) As %String [ SqlProc ]
{
    s request = {"operation":"info"}
    s request.namespace = expectedNamespace
    q ..Dispatch($system.Encryption.Base64Encode($zcvt(request.%ToJSON(), "O", "UTF8"), 1))
}

}
