# ObjectScript 命令速查

按 IRIS 官方目录收录 40 个通用命令条目和 8 个例程、调试命令条目。左列便于按官方名称检索，右列给出新增代码统一采用的项目写法。编写新代码时沿用 [CLS 命名与格式规范](cls-coding-format.md#命令表达式与缩进)的项目写法。函数、特殊变量、SQL 和类定义关键字各有独立语法。

## 大小写边界

在 `s size = $l(patientId)` 中仅命令和系统函数使用小写，变量仍是 `patientId`。在 `d $sy.OBJ.Help()` 中，`$sy` 是特殊变量，`OBJ` 和 `Help` 按类与方法的声明书写。宏同样按定义书写，如 `$$$UPPER(text)`；嵌入式 SQL 返回到 ObjectScript 的状态变量保留 `SQLCODE`。检查缩写时只匹配对应语法位置。

依据：[ObjectScript 大小写规则](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GCOS_syntax)、[$SYSTEM 成员访问示例](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GCOS_intro)、[系统宏定义](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_appx_sysmacros)。

## 通用命令

| 命令 | 项目写法 |
|---|---|
| `BREAK` | `b` |
| `CATCH` | `catch` |
| `CLOSE` | `c` |
| `CONTINUE` | `continue` |
| `DO` | `d` |
| `DO WHILE` | `do { … } while` |
| `ELSE` | `else` |
| `ELSEIF` | `elseif` |
| `FOR` | `for` |
| `GOTO` | `g` |
| `HALT` | `halt` |
| `HANG` | `hang` |
| `IF` | `if` |
| `JOB` | `j` |
| `KILL` | `k` |
| `LOCK` | `l` |
| `MERGE` | `m` |
| `NEW` | `n` |
| `OPEN` | `o` |
| `QUIT` | `q` |
| `READ` | `r` |
| `RETURN` | `ret` |
| `SET` | `s` |
| `TCOMMIT` | `tc` |
| `THROW` | `throw` |
| `TROLLBACK` | `tro` |
| `TRY` | `try` |
| `TSTART` | `ts` |
| `USE` | `u` |
| `VIEW` | `v` |
| `WHILE` | `while` |
| `WRITE` | `w` |
| `XECUTE` | `x` |
| `ZKILL` | `zk` |
| `ZNSPACE` | `zn` |
| `ZSU` | `zsu` |
| `ZTRAP` | `zt` |
| `ZWRITE` | `zw` |
| `ZZDUMP` | `zzdump` |
| `ZZWRITE` | `zzwrite` |

## 例程与调试

| 命令 | 项目写法 |
|---|---|
| `PRINT` | `p` |
| `ZBREAK` | `zb` |
| `ZINSERT` | `zi` |
| `ZLOAD` | `zl` |
| `ZPRINT` | `zp` |
| `ZREMOVE` | `zr` |
| `ZSAVE` | `zs` |
| `ZZPRINT` | `zzprint` |

无参数的 `h` 表示 HALT，有参数的 `h` 表示 HANG。块式控制流按项目规范使用全拼，如 `do { … } while condition`；调用方法时的 DO 可写作 `d`。事务命令缩写保留回滚层级与后条件。

## 常用内建函数

| 官方名称 | 项目写法 |
|---|---|
| `$LENGTH` | `$l(…)` |
| `$GET` | `$g(…)` |
| `$PIECE` | `$p(…)` |
| `$DATA` | `$d(…)` |
| `$ORDER` | `$o(…)` |
| `$QUERY` | `$q(…)` |
| `$NAME` | `$na(…)` |
| `$QLENGTH` | `$ql(…)` |
| `$QSUBSCRIPT` | `$qs(…)` |
| `$EXTRACT` | `$e(…)` |
| `$FIND` | `$f(…)` |
| `$SELECT` | `$s(…)` |
| `$TRANSLATE` | `$tr(…)` |
| `$CHAR` | `$c(…)` |
| `$ASCII` | `$a(…)` |
| `$ZCONVERT` | `$zcvt(…)` |
| `$INCREMENT` | `$i(…)` |
| `$JUSTIFY` | `$j(…)` |
| `$RANDOM` | `$r(…)` |
| `$LISTBUILD` | `$lb(…)` |
| `$LIST` | `$li(…)` |
| `$LISTGET` | `$lg(…)` |
| `$LISTLENGTH` | `$ll(…)` |
| `$LISTDATA` | `$ld(…)` |
| `$LISTFIND` | `$lf(…)` |
| `$LISTFROMSTRING` | `$lfs(…)` |
| `$LISTTOSTRING` | `$lts(…)` |
| `$LISTVALID` | `$lv(…)` |
| `$ZDATE` | `$zd(…)` |
| `$ZDATEH` | `$zdh(…)` |
| `$ZTIME` | `$zt(…)` |
| `$ZTIMEH` | `$zth(…)` |
| `$ZDATETIME` | `$zdt(…)` |
| `$ZDATETIMEH` | `$zdth(…)` |
| `$STACK` | `$st(…)` |
| `$TEXT` | `$t(…)` |

## 常用特殊变量

| 官方名称 | 项目写法 |
|---|---|
| `$HOROLOG` | `$h` |
| `$JOB` | `$j` |
| `$TLEVEL` | `$tl` |
| `$TEST` | `$t` |
| `$IO` | `$i` |
| `$DEVICE` | `$d` |
| `$PRINCIPAL` | `$p` |
| `$QUIT` | `$q` |
| `$STACK` | `$st` |
| `$STORAGE` | `$s` |
| `$ZERROR` | `$ze` |
| `$ZTRAP` | `$zt` |
| `$ZTIMESTAMP` | `$zts` |
| `$SYSTEM` | `$sy` |
| `$NAMESPACE` | `$namespace` |

例如取字符串长度写 `s size = $l(text)`，取列表元素数写 `s count = $ll(items)`。`$j(value,width)` 是 $JUSTIFY，`$j` 是进程号；`$zt(time)` 是 $ZTIME，`$zt` 是错误陷阱。

核对来源：[通用命令目录](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_COMMANDS)、[例程与调试目录](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_ZCOMMANDS)、[官方缩写表](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_abbreviations)。
