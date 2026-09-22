# JSON 和对象互转说明

## JSON 转为对象

**调用方法:** `s obj={}.%FromJSON(jsonStr)`

**示例:**
```objectscript
s jsonStr="{""a"":""1"",""code"":""2""}"
s obj={}.%FromJSON(jsonStr)
s a=obj.a
s code=obj.code
q ""
```

## 对象转为 JSON

**对象构建:** `s obj = {}`

**对象转 JSON:** `s json= obj.%ToJSON()`

**示例:**
```objectscript
s obj={}
s obj.a=1
s obj.b=1
s jsonStr= obj.%ToJSON()
q jsonStr
```
