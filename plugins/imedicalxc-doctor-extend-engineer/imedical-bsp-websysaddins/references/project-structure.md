# Java 读卡器中间件工程结构详解

> 以 `com.mediway.his.doctor.device`（标版读卡改造工程）为蓝本

---

## 一、工程总览

```
com.mediway.his.doctor.device/
├── pom.xml                              # Maven 构建配置
├── src/
│   ├── main/
│   │   ├── java/                        # Java 源码
│   │   └── resources/                   # 厂商 DLL / 驱动文件
│   └── test/
└── target/                              # 编译产物（打包后的 JAR）
```

**规模**：支持 **25 家读卡器厂商**，覆盖 **Windows + Linux** 双平台，共 **50+ 种设备型号**。

---

## 二、目录结构与职责

### 2.1 Java 源码层 (`src/main/java`)

```
com/mediway/his/doctor/device/
├── controller/
│   └── ReadDevice.java                  # 🔑 入口类（main 方法），统一调度入口
├── service/
│   ├── DeviceService.java               # 🔑 抽象基类，定义读卡策略（模板方法模式）
│   └── {厂商名}/                        # 每个厂商一个目录
│       └── {型号}/                      # 每个型号一个目录
│           └── dev{序号}/               # 同一型号的不同驱动版本
│               └── {windows | linux}/   # 按操作系统分目录
│                   ├── XxxLibrary.java          # JNA 接口声明（映射 DLL 函数）
│                   └── XxxServiceImpl.java      # 业务实现（继承 DeviceService）
├── model/
│   ├── dto/
│   │   └── ReadDeviceDTO.java           # 入参 DTO（启用开关 + 卡号等）
│   └── vo/
│       ├── Response.java                # 统一响应封装 {code, msg, data}
│       ├── PersonVO.java                # 人员信息出参（身份证、社保卡等）
│       └── CardVO.java                  # 卡信息出参（卡号 + 安全线）
├── utils/
│   ├── Common.java                      # 公共工具方法
│   └── DynamicInvoker.java              # 反射动态调用工具
└── enums/
    ├── CountryEnums.java                # 国籍枚举
    ├── CredEnums.java                   # 证件类型枚举
    ├── NationEnums.java                 # 民族枚举
    └── SexEnums.java                    # 性别枚举
```

### 2.2 原生资源层 (`src/main/resources`) — **DLL 放置位置**

厂商驱动文件（DLL / .ini / .h / .so 等）按与 **service 层完全镜像** 的目录结构存放：

```
src/main/resources/
├── META-INF/                            # Maven 打包元数据
└── {厂商名}/                            # 与 service 包名一一对应（25 个厂商）
    └── {型号}/
        └── dev{序号}/
            └── {windows | linux}/
                ├── *.dll                 # 厂商提供的驱动 DLL 文件
                ├── *.ini                 # 配置文件
                ├── *.h                   # 头文件（部分厂商提供）
                ├── *.txt                 # 说明文档
                ├── *.dat / *.lib         # 许可证/库文件
                └── 64/                   # 部分 64 位 DLL 单独存放
                    └── *.dll             # 64 位版本驱动
```

#### 目录命名规则

| 层级 | 含义 | 示例 |
|------|------|------|
| `{厂商名}` | 读卡器厂商拼音/英文 | `huaDa`(华大)、`deKa`(德卡)、`dongXin`(东信) |
| `{型号}` | 设备型号标识 | `hd100`、`hd900`、`t10`、`f11` |
| `dev{序号}` | 同型号不同驱动版本 | `dev1`、`dev2` … `dev8` |
| `windows/linux` | 操作系统平台 | Windows 或 Linux |

---

## 三、架构设计

### 3.1 核心调用链路

```
JS 端调用:  JavaReadDevice.cmd(execStr, false)
                         │
                         ▼  execStr = "hardType.methodName.jsonParams"
              ┌─────────────────────────────┐
              │     ReadDevice.main()       │  ← 入口类
              │  解析 hardType → 拼装类名     │
              │  格式: service.{厂商}.{型号}.{系统}dev{N}ServiceImpl
              └──────────────┬──────────────┘
                             │  DynamicInvoker 反射调用
                             ▼
              ┌─────────────────────────────┐
              │    DeviceService (抽象基类)    │  ← 模板方法模式
              │  readPersonInfo()            │     定义读卡策略流程
              │  readMagCard()               │     身份证→社保卡→健康卡→...
              └──────────────┬──────────────┘
                             │  继承实现
                             ▼
              ┌─────────────────────────────┐
              │  XxxServiceImpl (具体设备实现)  │  ← 如 HuaDaHd100Dev1ServiceImpl
              │  readIdCard()  → JNA 调用 DLL  │
              │  readInsuCard()→ JNA 调用 DLL  │
              └──────────────┬──────────────┘
                             │  JNA Native.load()
                             ▼
              ┌─────────────────────────────┐
              │     XxxLibrary (JNA 接口)     │  ← 声明 DLL 函数签名
              │  LIBRARY_NAME = "相对路径"     │  → resources/下的 .dll
              └─────────────────────────────┘
```

### 3.2 类名动态拼装规则

`ReadDevice.main()` 根据 `hardType` 参数自动拼接目标实现类的全限定名：

```java
// hardType 示例: "huaDa.hd100.dev1"
// 拼装结果:
String className = "com.mediway.his.doctor.device.service."
    + "huaDa" + "."           // 前缀（取前3段）
    + "windows" + "."         // 系统（自动判断 Platform.isWindows()）
    + "HuaDaHd100Dev1ServiceImpl";  // 后缀（首字母大写驼峰）
```

### 3.3 DLL 加载方式 — JNA

每个设备通过 **JNA（Java Native Access）** 调用厂商原生 DLL：

```java
// ① Library 接口声明 DLL 函数
public interface HuaDaHd100Dev1Library extends Library {
    // DLL 相对于 classpath/resources 的路径
    String LIBRARY_NAME = "huaDa/hd100/dev1/windows/SSCardDriver.dll";

    // JNA 加载 DLL 为 Java 可调用接口
    HuaDaHd100Dev1Library INSTANCE = Native.load(LIBRARY_NAME, HuaDaHd100Dev1Library.class);

    // 声明 DLL 导出函数签名
    int iReadCertInfo(int iType, String pPhotoPath, byte[] pPhotoData, byte[] pOutInfo);
    int iReadCardBas(int iType, String pDevInfo, byte[] pOutInfo);
}

// ② ServiceImpl 中直接调用
HuaDaHd100Dev1Library.INSTANCE.iReadCertInfo(0, "", photoData, outInfo);
```

**关键点**：`LIBRARY_NAME` 的路径对应 `src/main/resources/` 下的实际 DLL 文件位置，Maven 打包后 DLL 进入 JAR 的根路径。

---

## 四、Maven 依赖 (pom.xml)

| 依赖 | 用途 | 版本 |
|------|------|------|
| `fastjson` | JSON 序列化/反序列化（阿里） | 1.2.83 |
| `hutool-all` | 工具集（JSON 对象处理等） | 5.8.25 |
| `lombok` | 简化 POJO（@Data, @Accessors） | 1.18.26 |
| `jna` + `jna-platform` | **Java 调用原生 DLL 的核心依赖** | 5.8.0 / 5.13.0 |
| `jackson-annotations` + `jsr310` | JSON 注解 + Java 8 日期支持 | 2.13.5 |
| `swagger-annotations` | API 文档注解 | 1.6.6 |
| `dom4j` + `jackson-dataformat-xml` | XML 处理 | 1.6.1 / 2.13.4 |
| `slf4j-api` + `logback-classic` | 日志框架 | 1.7.36 / 1.2.3 |

> **Java 版本**：1.8（兼容性考虑）

---

## 五、构建与部署

### 5.1 打包命令

```bash
mvn clean package
```

打包后 `target/` 目录生成包含所有 resources（DLL）的 **可执行 JAR**：

```
target/com.mediway.his.doctor.device-1.0-SNAPSHOT.jar
```

### 5.2 部署步骤

1. 将 `.jar` 文件复制到服务端 `web/addins/plugin/JavaReadDevice/` 目录
2. 在【客户端动态库维护】中配置：
   - **应用文件路径**：`JavaReadDevice/JavaReadDevice.zip`（或 jar）
   - **程序集名**：`ReadDevice`
   - **类名**：`ReadDevice`
   - **调用 ID 名**：`JavaReadDevice`
   - **版本号**：递增更新
3. 客户端启动时自动下载并解压到本地

### 5.3 本地测试

```bash
java -jar com.mediway.his.doctor.device.jar <hardType> <methodName> <jsonParams>

# 示例：读身份证
java -jar com.mediway.his.doctor.device.jar huaDa.hd100.dev1 readPersonInfo "{\"enableIdCard\":true}"
```

---

## 六、扩展新设备指南

当需要接入一个新的读卡器型号时，只需按以下模板添加文件：

### 6.1 步骤

1. **resources/** 下创建目录并放入厂商 DLL：
   ```
   resources/{newVendor}/{newModel}/dev1/windows/*.dll
   ```

2. **service/** 下创建两个 Java 文件：

   ```java
   // ① JNA 接口声明 — 映射 DLL 函数
   package com.mediway.his.doctor.device.service.{newVendor}.{newModel}.dev1.windows;
   
   import com.sun.jna.Library;
   import com.sun.jna.Native;
   
   public interface NewDeviceLibrary extends Library {
       // DLL 相对于 classpath/resources 的路径
       String LIBRARY_NAME = "{newVendor}/{newModel}/dev1/windows/DriverDllName.dll";
       
       // JNA 加载 DLL 为 Java 可调用接口
       NewDeviceLibrary INSTANCE = Native.load(LIBRARY_NAME, NewDeviceLibrary.class);
       
       // 声明 DLL 导出的 native 方法
       int readCard(byte[] cardNo, byte[] outInfo);
       int readIdCard(byte[] idInfo);
       // ... 其他厂商 DLL 函数
   }
   ```

   ```java
   // ② 业务实现 — 继承 DeviceService
   package com.mediway.his.doctor.device.service.{newVendor}.{newModel}.dev1.windows;
   
   import com.mediway.his.doctor.device.service.DeviceService;
   import com.mediway.his.doctor.device.model.vo.PersonVO;
   import com.mediway.his.doctor.device.model.vo.CardVO;
   import com.mediway.his.doctor.device.model.vo.Response;
   
   public class NewDeviceServiceImpl extends DeviceService {
       
       @Override
       protected Response<PersonVO> readIdCard() {
           // 调用 NewDeviceLibrary 读取身份证
           byte[] idInfo = new byte[1024];
           int result = NewDeviceLibrary.INSTANCE.readIdCard(idInfo);
           
           if (result == 0) {
               // 解析身份证信息并封装为 PersonVO
               PersonVO person = parseIdCardInfo(idInfo);
               return Response.success(person);
           } else {
               return Response.error("读身份证失败，错误码：" + result);
           }
       }
       
       @Override
       protected Response<PersonVO> readInsuCard() {
           // 实现社保卡读取
           // ...
       }
       
       @Override
       protected Response<CardVO> readRfCard() {
           // 实现射频卡读取
           // ...
       }
       
       @Override
       protected Response<CardVO> readMagCard() {
           // 实现磁条卡读取
           // ...
       }
   }
   ```

3. **无需修改任何已有代码** — `DynamicInvoker` 会根据 `hardType` 自动发现并调用新实现类

### 6.2 命名规范

| 项目 | 规则 | 示例 |
|------|------|------|
| 厂商目录 | 小写拼音/英文 | `huaDa`, `dongXin` |
| 型号目录 | 小写+数字 | `hd100`, `est100`, `t10` |
| Library 类 | `{Vendor}{Model}Dev{N}Library` | `HuaDaHd100Dev1Library` |
| ServiceImpl 类 | `{Vendor}{Model}Dev{N}ServiceImpl` | `HuaDaHd100Dev1ServiceImpl` |
| DLL 路径 | 与 resources 目录一致 | `huaDa/hd100/dev1/windows/SSCardDriver.dll` |

---

## 七、核心类详解

### 7.1 ReadDevice.java（入口类）

```java
public class ReadDevice {
    
    public static void main(String[] args) {
        // args[0] = hardType (如 "huaDa.hd100.dev1")
        // args[1] = methodName (如 "readPersonInfo")
        // args[2] = jsonParams (如 "{\"enableIdCard\":true}")
        
        String hardType = args[0];
        String methodName = args[1];
        String jsonParams = args[2];
        
        // 动态拼装类名
        String className = buildClassName(hardType);
        
        // 反射调用
        DeviceService service = DynamicInvoker.invoke(className);
        
        // 执行对应方法
        Response response = service.execute(methodName, jsonParams);
        
        // 输出结果到 stdout
        System.out.println(JSON.toJSONString(response));
    }
    
    private static String buildClassName(String hardType) {
        // huaDa.hd100.dev1 → com.mediway.his.doctor.device.service.huaDa.windows.HuaDaHd100Dev1ServiceImpl
        String[] parts = hardType.split("\\.");
        String vendor = parts[0];
        String model = parts[1];
        String dev = parts[2];
        String os = Platform.isWindows() ? "windows" : "linux";
        
        return String.format(
            "com.mediway.his.doctor.device.service.%s.%s.%s%sServiceImpl",
            vendor, os,
            capitalize(vendor) + capitalize(model) + capitalize(dev)
        );
    }
}
```

### 7.2 DeviceService.java（抽象基类）

```java
public abstract class DeviceService {
    
    /**
     * 读人员信息（策略模式：身份证→社保卡→健康卡→...）
     */
    public Response<PersonVO> readPersonInfo(ReadDeviceDTO dto) {
        // 1. 尝试读身份证
        if (dto.isEnableIdCard()) {
            Response<PersonVO> result = readIdCard();
            if (result.isSuccess()) return result;
        }
        
        // 2. 尝试读社保卡
        if (dto.isEnableInsuCard()) {
            Response<PersonVO> result = readInsuCard();
            if (result.isSuccess()) return result;
        }
        
        // 3. 尝试读健康卡
        if (dto.isEnableHealthCard()) {
            Response<PersonVO> result = readHealthCard();
            if (result.isSuccess()) return result;
        }
        
        return Response.error("未读取到有效卡片");
    }
    
    /**
     * 读磁条卡（卡号 + 安全线）
     */
    public Response<CardVO> readMagCard() {
        return doReadMagCard();
    }
    
    // 子类必须实现的抽象方法
    protected abstract Response<PersonVO> readIdCard();
    protected abstract Response<PersonVO> readInsuCard();
    protected abstract Response<PersonVO> readHealthCard();
    protected abstract Response<CardVO> readRfCard();
    protected abstract Response<CardVO> doReadMagCard();
}
```

### 7.3 DynamicInvoker.java（反射工具）

```java
public class DynamicInvoker {
    
    @SuppressWarnings("unchecked")
    public static <T> T invoke(String className) {
        try {
            Class<?> clazz = Class.forName(className);
            return (T) clazz.getDeclaredConstructor().newInstance();
        } catch (Exception e) {
            throw new RuntimeException("无法实例化类: " + className, e);
        }
    }
}
```

---

## 八、故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| `ClassNotFoundException` | hardType 拼写错误 | 检查 hardType 格式：厂商.型号.devN |
| `UnsatisfiedLinkError` | DLL 路径错误或 32/64 位不匹配 | 检查 LIBRARY_NAME 路径；确保 JDK 与 DLL 位数一致 |
| 返回结果为空 | Thread attach 脏数据 | JS 端过滤 `Thread-\d+ attach success` |
| 读卡超时 | 设备未连接或驱动问题 | 检查设备连接；更新厂商驱动 |
| 中文乱码 | DLL 返回编码不一致 | 使用正确的字符集解析字节数组 |

---

## 九、支持的厂商列表（部分）

| 厂商 | 目录名 | 支持型号 |
|------|--------|----------|
| 华大 | `huaDa` | hd100, hd900 |
| 德卡 | `deKa` | t10, t6 |
| 东信 | `dongXin` | est100, f11 |
| 明华 | `mingHua` | rd-eb, rd-et |
| 神思 | `shenSi` | ss628-100 |
| ... | ... | ... |

> 完整列表请参考实际工程中的 `src/main/resources/` 目录
