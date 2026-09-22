# XML和对象互转说明

## XML转为对象

**调用方法:** `w ##class(DHCDoc.Util.FromXML).XML2Arr(xmlStr)`

**示例:**
```objectscript
s xmlStr = "<?xml version='1.0' encoding='UTF-8'?><Request><a1>1</a1><a1>2</a1><code>0</code></Request>"
s obj = ##class(DHCDoc.Util.FromXML).XML2Arr(xmlStr)
q:'$ISObject(obj) obj
s a1=obj.a1
s code=obj.code
q ""
```

## 对象转为XML

**对象构建:** `s obj = ##class(DHCDoc.Util.ArrayData).%New()`

**对象转xml:** `s xmlStream= obj.%ToXML()`

**示例:**
```objectscript
s obj = ##class(DHCDoc.Util.ArrayData).%New()
s obj.a=1
s obj.b=1
s xmlStream= obj.%ToXML("Response")
q xmlStream
```
