# 城市集中供热管网与换热站运行管理平台

面向一次二次管网台账、换热站运行、水力平衡调节、热计量抄表、抢修处置、停暖通知与热费结算的一体化城市集中供热运行管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 换热站台账 | `heatstation` | 换热站 | 站名、所属片区、供热面积 |
| 一次管网 | `primarynet` | 一次管网管段 | 管段编号、起点、终点 |
| 二次管网 | `secondarynet` | 二次管网管段 | 管段编号、所属片区、公称管径 |
| 站点巡检 | `stationpatrol` | 巡检记录 | 巡检编号、巡检站点、巡检路线 |
| 室温监测 | `roomtemp` | 室温监测点 | 监测编号、住户地址、所属片区 |
| 水力平衡 | `hydraulic` | 平衡调节记录 | 调节编号、换热站、调节回路 |
| 热计量抄表 | `heatmeter` | 热计量抄表记录 | 抄表编号、计量表号、用户名称 |
| 抢修处置 | `emergencyrepair` | 抢修记录 | 抢修编号、故障管段、故障类型 |
| 阀门井维护 | `valvewell` | 阀门井 | 井编号、所属管段、井盖状况 |
| 循环泵运维 | `circpump` | 循环泵 | 泵编号、所属换热站、泵型号 |
| 补水定压 | `makeupwater` | 补水定压记录 | 记录编号、换热站、补水量 |
| 换热器清洗 | `hxclean` | 清洗记录 | 清洗编号、换热器编号、所属站点 |
| 锅炉房运行 | `boilerroom` | 锅炉运行记录 | 锅炉编号、锅炉吨位、燃烧方式 |
| 管网探漏 | `leakdetect` | 探漏记录 | 探漏编号、探测管段、探测方法 |
| 补偿器检查 | `compensator` | 补偿器检查记录 | 检查编号、所属管段、补偿器型号 |
| 停暖通知 | `heatnotice` | 停暖通知单 | 通知编号、影响片区、停暖原因 |
| 热费结算 | `heatbilling` | 热费结算单 | 结算编号、用户名称、用热面积 |
| 入户服务 | `householdservice` | 入户服务单 | 服务单号、报修用户、服务内容 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `district-heating:entries` 这一项，或调用 `resetModule(模块)`。

## 巡检问题按整改期限分册打包

站点巡检页（`stationpatrol`）支持把待整改问题按整改期限分册打成一个 zip 直接下载下发，逻辑在
`frontend/src/api/patrol-package.ts`，包记录独立持久化在 `district-heating:collection:patrol-packages`：

- **分片与权限**：巡检按「巡检路线」分片（见 `src/data/routes.ts` 的 `ROUTE_SLICES`），整改期限只由
  该片区的片区负责人核定。值班员、班组或跨片核定一律越级挡回；带筛选出包时筛到外片区/未登记分片的
  路线同样挡回。
- **期限区间**：区间从所选周一开始按周连续排开（每周一册）。区间参数缺失/非法、起始周一早于今天、
  入册记录整改期限缺失或不在全部区间内，都先挡下并指出具体巡检编号。
- **册子内容**：每册 CSV 抬头写明片区、下发班组、片区负责人、期限区间与整改截止日；明细列出
  巡检编号、巡检站点、巡检路线、巡检人、巡检日期、发现问题数、整改期限，数据与巡检列表同源
  （直接读 `stationpatrol`，不分册不改写）。
- **空期限段**：当期没内容的期限段不生成空文件，只在包内「分册清单 CSV」里附一段说明。
- **待核对清单**：出包结果落到热计量抄表页（`heatmeter`）的「巡检分册待核对清单」，核对后移除。
- **幂等**：按「片区 + 期限区间 + 入册记录」生成指纹，重复提交复用原包并重新下载，只记一次。
- 已整改或发现问题数为 0 的记录不入册；身份切换在巡检页顶部的「当前操作身份」里。

