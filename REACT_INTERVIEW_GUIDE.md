# React 17 面试核心原理学习指南

> 本指南专注于面试必备的 React 核心原理，不深挖所有源码细节，只关注关键概念和代码位置。

## 学习目标

通过本指南，你将掌握：
- ✅ Fiber 架构原理
- ✅ Hooks 实现机制
- ✅ Diff 算法核心逻辑
- ✅ 更新流程（render 和 commit）
- ✅ 调度和优先级

---

## 📚 学习路线图

### 第一部分：Fiber 架构（必考）

**核心问题：**
- 什么是 Fiber？为什么需要 Fiber？
- Fiber 节点包含哪些关键信息？
- 双缓存机制是什么？

**需要阅读的文件：**

1. **Fiber 节点类型定义**
   - 📁 文件：`packages/react-reconciler/src/ReactWorkTags.js`
   - 📍 位置：完整文件（62 行）
   - 🎯 重点：理解 FunctionComponent、ClassComponent、HostComponent 等类型

2. **Fiber 节点结构**
   - 📁 文件：`packages/react-reconciler/src/ReactFiber.new.js`
   - 📍 位置：
     - `FiberNode` 构造函数（约 100-200 行）
     - `createFiber` 函数
   - 🎯 重点：理解 return、child、sibling、alternate、flags 等关键属性

3. **副作用标记**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberFlags.js`
   - 📍 位置：完整文件（约 50 行）
   - 🎯 重点：Placement、Update、Deletion 等标记的含义

---

### 第二部分：Hooks 原理（高频考点）

**核心问题：**
- useState 如何保存状态？
- useEffect 何时执行？
- 为什么 Hooks 不能在条件语句中使用？
- Hook 是如何串联的？

**需要阅读的文件：**

4. **Hooks 实现**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberHooks.new.js`
   - 📍 核心位置：
     - `renderWithHooks` 函数（约 300-400 行）- 渲染入口
     - `mountState` 函数（约 1000 行附近）- useState 首次挂载
     - `updateState` 函数 - useState 更新
     - `mountEffect` 函数（约 1200 行附近）- useEffect 首次挂载
     - `updateEffect` 函数 - useEffect 更新
     - `Hook` 类型定义（文件顶部）
   - 🎯 重点：
     - Hook 链表结构（memoizedState）
     - 更新队列（queue）
     - dispatcher 切换机制

---

### 第三部分：Diff 算法（必考）

**核心问题：**
- React Diff 的三个策略是什么？
- 单节点 Diff 如何判断复用？
- 多节点 Diff 的两轮遍历做什么？
- key 的作用是什么？

**需要阅读的文件：**

5. **Diff 算法实现**
   - 📁 文件：`packages/react-reconciler/src/ReactChildFiber.new.js`
   - 📍 核心位置：
     - `reconcileChildFibers` 函数（约 1300 行）- Diff 入口
     - `reconcileSingleElement` 函数（约 1000 行）- 单节点 Diff
     - `reconcileChildrenArray` 函数（约 700 行）- 多节点 Diff
     - `placeChild` 函数 - 标记插入
     - `deleteChild` 函数 - 标记删除
   - 🎯 重点：
     - key 和 type 的比较逻辑
     - 第一轮遍历：处理更新
     - 第二轮遍历：处理新增和删除

---

### 第四部分：更新流程（核心流程）

**核心问题：**
- render 阶段做什么？commit 阶段做什么？
- 为什么 render 阶段可以中断，commit 阶段不能？
- beginWork 和 completeWork 分别做什么？

**需要阅读的文件：**

6. **工作循环**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberWorkLoop.new.js`
   - 📍 核心位置：
     - `performSyncWorkOnRoot` 函数（约 1000 行）- 同步渲染入口
     - `renderRootSync` 函数（约 1500 行）- render 阶段入口
     - `workLoopSync` 函数 - 工作循环
     - `commitRoot` 函数（约 2000 行）- commit 阶段入口
     - `commitBeforeMutationEffects` - before mutation
     - `commitMutationEffects` - mutation（DOM 操作）
     - `commitLayoutEffects` - layout
   - 🎯 重点：
     - render 和 commit 两大阶段
     - workInProgress 树的构建

7. **BeginWork（递阶段）**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberBeginWork.new.js`
   - 📍 核心位置：
     - `beginWork` 函数（约 3000 行）- 根据 tag 分发
     - `updateFunctionComponent` 函数（约 600 行）- 处理函数组件
     - `reconcileChildren` 函数 - 调用 Diff
   - 🎯 重点：根据节点类型调用不同的更新函数

8. **CompleteWork（归阶段）**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberCompleteWork.new.js`
   - 📍 核心位置：
     - `completeWork` 函数（约 700 行）- 完成节点
     - `createInstance` - 创建 DOM 节点
     - `appendAllChildren` - 插入子节点
   - 🎯 重点：DOM 节点的创建和属性处理

---

### 第五部分：调度和优先级

**核心问题：**
- React 如何实现时间切片？
- 优先级如何工作？
- Lane 模型是什么？

**需要阅读的文件：**

9. **Lane 优先级模型**
   - 📁 文件：`packages/react-reconciler/src/ReactFiberLane.js`
   - 📍 核心位置：
     - Lane 常量定义（文件顶部）
     - `mergeLanes` 函数 - 合并优先级
     - `pickArbitraryLane` 函数 - 选择优先级
   - 🎯 重点：不同场景的优先级级别

10. **调度器**
    - 📁 文件：`packages/scheduler/src/Scheduler.js`
    - 📍 核心位置：
      - `unstable_scheduleCallback` 函数（约 300 行）- 调度任务
      - `workLoop` 函数（约 150 行）- 任务执行循环
      - `shouldYieldToHost` 函数 - 判断是否让出执行权
    - 🎯 重点：时间切片的实现（5ms 判断）

---

## 🎯 面试高频问题对照表

| 面试问题 | 对应章节 | 关键文件 |
|---------|---------|---------|
| 什么是 Fiber？ | 第一部分 | ReactFiber.new.js |
| 为什么需要 Fiber？ | 第一部分 + 第五部分 | ReactFiberWorkLoop.new.js |
| useState 原理 | 第二部分 | ReactFiberHooks.new.js:mountState |
| useEffect 何时执行 | 第二部分 + 第四部分 | ReactFiberWorkLoop.new.js:commitLayoutEffects |
| Hooks 为何不能在 if 中 | 第二部分 | ReactFiberHooks.new.js:Hook链表 |
| Diff 算法原理 | 第三部分 | ReactChildFiber.new.js |
| key 的作用 | 第三部分 | ReactChildFiber.new.js:reconcileSingleElement |
| render 和 commit 区别 | 第四部分 | ReactFiberWorkLoop.new.js |
| 为什么 render 可中断 | 第四部分 + 第五部分 | ReactFiberWorkLoop.new.js:workLoopSync |
| 时间切片原理 | 第五部分 | Scheduler.js:shouldYieldToHost |
| 优先级如何工作 | 第五部分 | ReactFiberLane.js |

---

## 📖 学习建议

### 阅读顺序（推荐）

**快速通关（2-3 天）：**
1. 第一部分：Fiber 架构（1 小时）
2. 第二部分：Hooks 原理（2 小时）
3. 第三部分：Diff 算法（1.5 小时）
4. 第四部分：更新流程概览（1 小时）

**深入理解（1 周）：**
1. 按照文档顺序，每天学习一个部分
2. 对照面试问题，尝试自己回答
3. 在 Chrome DevTools 中调试实际代码

### 如何使用本指南

1. **VSCode 快捷键导航：**
   - `Ctrl+P`（Mac: `Cmd+P`）：快速打开文件
   - `Ctrl+G`（Mac: `Cmd+G`）：跳转到指定行
   - `Ctrl+F`（Mac: `Cmd+F`）：在文件中搜索函数名

2. **查看带注释的代码：**
   - 所有标注为「需要阅读」的文件已添加中文注释
   - 注释格式：`// 【面试重点】说明文字`

3. **验证理解：**
   - 尝试不看代码，讲解核心流程
   - 画出 Fiber 树的结构
   - 手写简化版的 useState 实现

---

## 🔖 快速查找索引

### 按概念查找

- **Fiber 节点结构** → ReactFiber.new.js:100-200
- **Hook 链表** → ReactFiberHooks.new.js:1-50（类型定义）
- **单节点 Diff** → ReactChildFiber.new.js:1000
- **多节点 Diff** → ReactChildFiber.new.js:700
- **render 阶段** → ReactFiberWorkLoop.new.js:1500
- **commit 阶段** → ReactFiberWorkLoop.new.js:2000
- **时间切片** → Scheduler.js:150

### 按文件查找

所有文件都在 `packages/` 目录下：

```
packages/
├── react-reconciler/src/
│   ├── ReactWorkTags.js          # Fiber 类型
│   ├── ReactFiber.new.js         # Fiber 节点
│   ├── ReactFiberFlags.js        # 副作用标记
│   ├── ReactFiberHooks.new.js    # Hooks 实现
│   ├── ReactChildFiber.new.js    # Diff 算法
│   ├── ReactFiberWorkLoop.new.js # 工作循环
│   ├── ReactFiberBeginWork.new.js   # beginWork
│   ├── ReactFiberCompleteWork.new.js # completeWork
│   └── ReactFiberLane.js         # 优先级
└── scheduler/src/
    └── Scheduler.js              # 调度器
```

---

## 📝 学习进度追踪

- [ ] 第一部分：Fiber 架构
- [ ] 第二部分：Hooks 原理
- [ ] 第三部分：Diff 算法
- [ ] 第四部分：更新流程
- [ ] 第五部分：调度和优先级

---

## 💡 额外资源

- React 17 官方文档：https://reactjs.org/
- 推荐阅读源码时配合 React DevTools Profiler
- 可以在 `fixtures/` 目录找到示例项目进行调试

---

**祝你面试顺利！** 🎉
