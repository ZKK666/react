# 02 - Fiber 架构和调度原理

## 核心概念

### 1. Fiber 架构的诞生背景

#### React 15 及之前的问题

在 Fiber 架构之前，React 使用的是**栈协调器（Stack Reconciler）**：

```javascript
// React 15 的递归更新（简化示例）
function reconcile(element) {
  // 更新当前节点
  updateNode(element);

  // 递归更新子节点 - 不可中断！
  element.children.forEach(child => {
    reconcile(child);  // 同步递归调用
  });
}
```

**问题**：
1. **同步且不可中断**：一旦开始更新，必须完成整棵树的遍历
2. **长时间占用主线程**：复杂组件树的更新会阻塞用户交互
3. **掉帧**：超过 16.6ms（60fps）会导致界面卡顿
4. **无法处理优先级**：所有更新都是同等重要的

#### Fiber 架构的解决方案

Fiber 引入了**可中断的异步更新**：

```
React 15 栈协调器:
更新开始 → [持续占用主线程] → 更新结束
    |                              |
    └─────────── 阻塞 ───────────┘

React 16+ Fiber:
更新开始 → [工作片段] → 让出控制权 → [工作片段] → ... → 更新结束
           5ms         ↓ 浏览器渲染   5ms
                    用户交互/动画
```

### 2. Fiber 是什么？

Fiber 有三层含义：

1. **架构层面**：React 16 的新协调引擎
2. **数据结构**：每个 React 元素对应的工作单元节点
3. **工作单元**：一个可被中断和恢复的任务单位

## Fiber 节点的数据结构

### 核心字段解析

**位置**：`packages/react-reconciler/src/ReactFiber.js:240-277`

```javascript
function createFiberImplObject(
  tag: WorkTag,
  pendingProps: mixed,
  key: null | string,
  mode: TypeOfMode,
): Fiber {
  const fiber: Fiber = {
    // ===== 实例信息 =====
    tag,              // 标识 Fiber 类型（函数组件、类组件、DOM 元素等）
    key,              // 用于 Diff 算法的唯一标识
    elementType: null,// ReactElement.type，首次创建时和 type 相同
    type: null,       // 函数组件指向函数本身，类组件指向类，DOM 元素是字符串
    stateNode: null,  // 真实 DOM 节点或组件实例

    // ===== Fiber 树结构 =====
    return: null,     // 父 Fiber（指向父节点）
    child: null,      // 第一个子 Fiber
    sibling: null,    // 下一个兄弟 Fiber
    index: 0,         // 在父节点中的索引

    // ===== 状态和属性 =====
    ref: null,            // ref 引用
    refCleanup: null,     // ref 清理函数

    pendingProps: null,   // 新传入的 props（即将应用）
    memoizedProps: null,  // 上次渲染使用的 props
    updateQueue: null,    // 更新队列（setState、forceUpdate 等）
    memoizedState: null,  // 上次渲染的 state（函数组件中是 hooks 链表）
    dependencies: null,   // context、memo 的依赖

    // ===== 副作用标记 =====
    flags: NoFlags,       // 当前 Fiber 的副作用标记（Placement、Update、Deletion 等）
    subtreeFlags: NoFlags,// 子树的副作用标记（优化：快速跳过无副作用子树）
    deletions: null,      // 需要删除的子 Fiber 数组

    // ===== 优先级调度 =====
    lanes: NoLanes,       // 当前 Fiber 的优先级
    childLanes: NoLanes,  // 子树中的优先级（用于跳过不需要更新的子树）

    // ===== 双缓存 =====
    alternate: null,      // 指向另一棵树中对应的 Fiber（current ↔ workInProgress）
  };

  return fiber;
}
```

### Fiber 类型（tag）

```javascript
// packages/react-reconciler/src/ReactWorkTags.js
export const FunctionComponent = 0;       // 函数组件
export const ClassComponent = 1;          // 类组件
export const IndeterminateComponent = 2;  // 未确定的组件类型
export const HostRoot = 3;                // 根节点（FiberRoot.current）
export const HostComponent = 5;           // DOM 元素（如 div、span）
export const HostText = 6;                // 文本节点
export const Fragment = 7;                // Fragment
export const Mode = 8;                    // StrictMode 等模式组件
export const ContextConsumer = 9;         // Context Consumer
export const ContextProvider = 10;        // Context Provider
export const MemoComponent = 14;          // React.memo
export const SimpleMemoComponent = 15;    // 简化的 memo 组件
// ... 还有更多类型
```

## 双缓存机制（Double Buffering）

### 为什么需要双缓存？

想象一个视频游戏的渲染：
- **单缓存**：直接在屏幕上绘制 → 用户会看到绘制过程（闪烁）
- **双缓存**：在后台缓冲区绘制完成后，一次性切换 → 流畅无闪烁

React 也采用了相同的思想！

### Current Tree vs WorkInProgress Tree

```
┌─────────────────────────────────────────────────────────┐
│                     FiberRootNode                       │
│  (整个应用的根，唯一且不会变化)                          │
└──────────────┬──────────────────────────────────────────┘
               │
               │ current
               ↓
      ┌────────────────┐         alternate        ┌────────────────┐
      │  Current Tree  │ ←─────────────────────→ │ WorkInProgress │
      │  (当前显示的)   │                          │     Tree       │
      │                │                          │ (正在构建的)    │
      └────────────────┘                          └────────────────┘
          已渲染到屏幕                                  内存中构建

渲染完成后 → FiberRoot.current 指针切换 → WorkInProgress 成为新的 Current
```

**位置**：`packages/react-reconciler/src/ReactFiber.js:325-375`

```javascript
/**
 * 创建 workInProgress 节点（双缓存的核心）
 */
export function createWorkInProgress(current: Fiber, pendingProps: any): Fiber {
  let workInProgress = current.alternate;

  if (workInProgress === null) {
    // 首次渲染或之前被清理了，创建新的 workInProgress
    // 这里使用了对象池技术：最多只需要两个版本的树
    workInProgress = createFiber(
      current.tag,
      pendingProps,
      current.key,
      current.mode,
    );

    // 复制基本信息
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;  // 共享 DOM 节点！

    // 建立双向连接
    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    // 复用已有的 workInProgress 节点
    workInProgress.pendingProps = pendingProps;
    workInProgress.type = current.type;

    // 清除上次渲染的副作用
    workInProgress.flags = NoFlags;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
  }

  // 复制状态（但不共享引用，避免相互影响）
  workInProgress.flags = current.flags & StaticMask;
  workInProgress.childLanes = current.childLanes;
  workInProgress.lanes = current.lanes;

  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;

  // 克隆依赖对象（会在 render 阶段被修改）
  const currentDependencies = current.dependencies;
  workInProgress.dependencies =
    currentDependencies === null
      ? null
      : {
          lanes: currentDependencies.lanes,
          firstContext: currentDependencies.firstContext,
        };

  return workInProgress;
}
```

### 双缓存的工作流程

```javascript
// 1. 首次渲染
ReactDOM.render(<App />, root);
// current tree 为空 → 创建 workInProgress tree → 渲染完成 → 切换指针

// 2. 更新
setState();
// 基于 current tree 创建 workInProgress tree → 应用更新 → 切换指针

// 3. 指针切换（原子操作）
fiberRoot.current = finishedWork;  // workInProgress 变成 current
// 旧的 current 变成 workInProgress，等待下次更新复用
```

## 任务调度与时间切片

### Scheduler 调度器

React 的 Scheduler 是一个独立的包，负责任务调度：

**核心概念**：
- **时间切片**：将长任务拆分为多个小任务
- **任务优先级**：高优先级任务可以打断低优先级任务
- **空闲调度**：利用浏览器的空闲时间执行任务

```javascript
// packages/react-reconciler/src/ReactFiberWorkLoop.js

/**
 * 工作循环：处理工作单元，直到没有更多工作或需要让出控制权
 */
function workLoopConcurrent() {
  // 核心：每处理完一个 Fiber，就检查是否需要让出控制权
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

/**
 * 同步工作循环（用于紧急更新，如用户输入）
 */
function workLoopSync() {
  // 不检查 shouldYield，一直执行直到完成
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

/**
 * 执行单个工作单元
 */
function performUnitOfWork(unitOfWork: Fiber): void {
  const current = unitOfWork.alternate;

  // 1. Begin work：处理当前 Fiber
  let next = beginWork(current, unitOfWork, renderLanes);

  // 2. 保存 props
  unitOfWork.memoizedProps = unitOfWork.pendingProps;

  if (next === null) {
    // 3. 没有子节点，完成当前节点
    completeUnitOfWork(unitOfWork);
  } else {
    // 4. 有子节点，继续处理子节点
    workInProgress = next;
  }
}
```

### shouldYield - 如何判断是否让出控制权？

```javascript
/**
 * 判断是否应该让出控制权
 * 位置：packages/scheduler/src/forks/Scheduler.js
 */
function shouldYield() {
  const currentTime = getCurrentTime();

  // 检查是否超过时间片（默认 5ms）
  if (currentTime >= deadline) {
    // 如果有更高优先级的任务，立即让出
    if (needsPaint || scheduling.isInputPending()) {
      return true;
    }
    // 否则可以继续执行一小段时间
    return currentTime >= maxYieldTime;
  }

  return false;
}
```

### Fiber 树的遍历顺序

```
         App
        /   \
     Div     Div
     /      /   \
   span   span  span

遍历顺序（深度优先）：
1. App (beginWork)
2. Div (beginWork)
3. span (beginWork)
4. span (completeWork) → 向上
5. Div (completeWork) → 向右
6. Div (beginWork)
7. span (beginWork)
8. span (completeWork) → 向右
9. span (beginWork)
10. span (completeWork) → 向上
11. Div (completeWork) → 向上
12. App (completeWork)
```

## 优先级系统（Lane 模型）

React 17+ 使用 **Lane 模型**来表示优先级（取代了 React 16 的 expirationTime）。

### 为什么叫 Lane（车道）？

想象高速公路：
- 不同车道有不同速度限制
- 快车道（高优先级）可以超越慢车道
- 多辆车可以同时在不同车道行驶（多个更新可以并存）

**位置**：`packages/react-reconciler/src/ReactFiberLane.js`

```javascript
// Lane 用二进制位表示优先级
export const NoLanes: Lanes = 0b0000000000000000000000000000000;
export const NoLane: Lane = 0b0000000000000000000000000000000;

// 同步车道（最高优先级）
export const SyncLane: Lane = 0b0000000000000000000000000000001;

// 输入连续事件（如鼠标拖动）
export const InputContinuousLane: Lane = 0b0000000000000000000000000000100;

// 默认车道（如 setTimeout、网络请求响应）
export const DefaultLane: Lane = 0b0000000000000000000000000010000;

// 过渡车道（低优先级，如 startTransition）
export const TransitionLanes: Lanes = 0b0000000001111111111111111000000;

// 空闲车道（最低优先级）
export const IdleLane: Lane = 0b0100000000000000000000000000000;
```

### Lane 的优势

```javascript
// 1. 合并多个优先级（位运算）
const lanes = SyncLane | DefaultLane;  // 0b10001

// 2. 检查是否包含某个优先级
const hasSyncLane = (lanes & SyncLane) !== 0;

// 3. 移除某个优先级
const remainingLanes = lanes & ~SyncLane;

// 4. 选择最高优先级
function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;  // 位运算技巧：获取最右边的 1
}
```

## 高频面试题

### Q1: 什么是 Fiber 架构？为什么需要 Fiber？

**答案**：

Fiber 是 React 16 引入的新协调引擎，它解决了 React 15 栈协调器的性能问题。

**为什么需要 Fiber？**

React 15 的问题：
1. **同步递归更新**：一旦开始更新组件树，无法中断
2. **长时间占用主线程**：导致页面卡顿、掉帧
3. **无法处理优先级**：紧急更新（如用户输入）和普通更新一视同仁

Fiber 的解决方案：
1. **可中断的异步更新**：将大任务拆分为小的工作单元
2. **时间切片**：每个工作单元执行后检查是否超时，及时让出控制权
3. **优先级调度**：高优先级任务可以打断低优先级任务
4. **增量渲染**：可以暂停、恢复、中止渲染

**核心数据结构**：
- Fiber 节点是一个链表结构（return、child、sibling）
- 链表结构便于中断和恢复（保存当前节点，下次从这里继续）

### Q2: Fiber 如何实现可中断渲染？

**答案**：

Fiber 通过三个关键机制实现可中断渲染：

**1. 链表结构代替递归调用栈**

```javascript
// React 15：递归（无法中断）
function walkTree(node) {
  doWork(node);
  node.children.forEach(walkTree);  // 递归调用
}

// React 16：循环 + 链表（可中断）
function workLoop() {
  while (workInProgress !== null && !shouldYield()) {
    workInProgress = performUnitOfWork(workInProgress);
  }
  // 中断后，workInProgress 保存了断点位置
}
```

**2. 工作单元拆分**

每个 Fiber 节点是一个工作单元，处理完一个节点后：
- 检查是否超过时间片（默认 5ms）
- 如果超时，保存当前进度，让出控制权
- 浏览器执行高优先级任务（渲染、用户交互）
- 继续执行剩余工作

**3. 双缓存机制**

- 更新过程在 workInProgress 树上进行，不影响已显示的 current 树
- 即使中断多次，用户看到的界面始终是完整的
- 更新完成后，一次性切换指针

### Q3: React 的调度机制是如何工作的？

**答案**：

React 的调度分为两个阶段：

**1. 调度阶段（Schedule）**

当触发更新时（setState、props 变化等）：

```javascript
function scheduleUpdateOnFiber(fiber, lane) {
  // 1. 标记 Fiber 及其祖先的 lanes
  markUpdateLaneFromFiberToRoot(fiber, lane);

  // 2. 根据优先级决定调度方式
  if (lane === SyncLane) {
    // 同步更新：立即执行
    performSyncWorkOnRoot(root);
  } else {
    // 异步更新：调度一个任务
    ensureRootIsScheduled(root);
  }
}

function ensureRootIsScheduled(root) {
  // 检查是否已有任务在执行
  // 比较新任务和旧任务的优先级
  // 如果新任务优先级更高，取消旧任务
  // 调度新任务
  scheduleCallback(priorityLevel, () => {
    performConcurrentWorkOnRoot(root);
  });
}
```

**2. 执行阶段（Work Loop）**

```javascript
function performConcurrentWorkOnRoot(root) {
  // 1. Render 阶段（可中断）
  renderRootConcurrent(root, lanes);

  // 2. Commit 阶段（不可中断，同步执行）
  if (完成了) {
    commitRoot(root);
  }
}

function renderRootConcurrent(root, lanes) {
  do {
    try {
      workLoopConcurrent();  // 可中断的工作循环
      break;
    } catch (thrownValue) {
      handleError(thrownValue);
    }
  } while (true);
}

function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
  // 中断后，下次调度会继续执行
}
```

**关键点**：
- **Render 阶段可中断**：执行 beginWork 和 completeWork
- **Commit 阶段不可中断**：执行 DOM 操作和副作用（必须同步完成，保证一致性）

### Q4: 什么是双缓存机制？

**答案**：

双缓存（Double Buffering）是一种在内存中构建完整帧，然后一次性显示的技术。

**在 React 中的体现**：

```
应用启动
   ↓
创建 FiberRootNode（唯一，不可变）
   ↓
   ├─→ current 指针指向 null
   └─→ 首次渲染创建 workInProgress 树
          ↓
       渲染完成后，指针切换
          ↓
   ├─→ current 指向渲染好的树（显示在屏幕上）
   └─→ workInProgress 变为 null

触发更新
   ↓
基于 current 树创建 workInProgress 树
   ↓
在 workInProgress 树上应用更新
   ↓
渲染完成后，指针切换
   ↓
current ↔ workInProgress（角色互换）
```

**优势**：
1. **流畅性**：用户始终看到完整的界面，不会看到中间状态
2. **可中断**：在内存中构建，可以随时中断和恢复
3. **性能**：复用 Fiber 节点，减少内存分配

**类比**：
- 视频游戏的双缓冲：在后台绘制下一帧，完成后切换
- React 的双缓存：在 workInProgress 树构建新界面，完成后切换

### Q5: Lane 模型相比 expirationTime 有什么优势？

**答案**：

React 17 用 Lane 模型替代了 React 16 的 expirationTime 模型。

**expirationTime 的问题**：

```javascript
// React 16 的方式
const expirationTime = computeExpirationTime();

// 问题1：难以表示批量更新
// 多个更新需要创建多个 expirationTime

// 问题2：优先级计算复杂
// 需要比较时间戳，涉及浮点运算

// 问题3：难以合并和分离优先级
```

**Lane 模型的优势**：

```javascript
// 1. 用二进制位表示优先级
const lanes = 0b0000000000000000000000000010101;
//                                      ↑ ↑ ↑
//                                      三个更新

// 2. 批量操作（位运算）
const newLanes = lanes | SyncLane;        // 添加
const hasSync = (lanes & SyncLane) !== 0; // 检查
const remaining = lanes & ~SyncLane;      // 移除

// 3. 一个数字表示多个优先级
// expirationTime 需要数组：[time1, time2, time3]
// Lane 只需一个数字：0b00010101

// 4. 性能更好
// 位运算比时间戳比较快得多
```

**具体优势**：
1. **批量更新**：一个数字可以表示多个更新
2. **性能更好**：位运算比浮点运算快
3. **更直观**：车道模型容易理解
4. **易于扩展**：可以方便地添加新的优先级

## 实战案例

### 案例 1：理解 Fiber 的中断和恢复

```javascript
function ExpensiveComponent() {
  // 模拟耗时操作
  const [count, setCount] = useState(0);

  // 大量计算
  const result = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 10000000; i++) {
      sum += i;
    }
    return sum;
  }, [count]);

  return <div onClick={() => setCount(c => c + 1)}>{result}</div>;
}

// React 的处理：
// 1. 开始渲染 ExpensiveComponent
// 2. 执行 useMemo（耗时）
// 3. 如果用户点击，新的更新会被调度
// 4. 根据优先级决定是否打断当前渲染
```

### 案例 2：使用 startTransition 降低更新优先级

```javascript
function SearchComponent() {
  const [inputValue, setInputValue] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const handleChange = (e) => {
    const value = e.target.value;

    // 输入框更新是高优先级（用户能直接感知）
    setInputValue(value);

    // 搜索结果更新是低优先级（可以稍后完成）
    startTransition(() => {
      setSearchResults(performSearch(value));  // 耗时操作
    });
  };

  return (
    <div>
      <input value={inputValue} onChange={handleChange} />
      <Results data={searchResults} />
    </div>
  );
}

// React 的处理：
// 1. 用户输入触发两个更新
// 2. setInputValue 是高优先级（SyncLane），立即执行
// 3. startTransition 中的更新是低优先级（TransitionLane）
// 4. 如果新的输入到来，低优先级更新会被中断
```

## 总结

1. **Fiber 架构**解决了 React 15 同步递归渲染的性能问题
2. **Fiber 节点**是链表结构，便于中断和恢复
3. **双缓存机制**保证了用户界面的流畅性和完整性
4. **时间切片**让 React 能够及时响应用户交互
5. **Lane 模型**提供了高效的优先级管理
6. **调度器**负责协调不同优先级的任务

## 相关源码文件

- `packages/react-reconciler/src/ReactFiber.js` - Fiber 节点创建
- `packages/react-reconciler/src/ReactFiberWorkLoop.js` - 工作循环和调度
- `packages/react-reconciler/src/ReactFiberLane.js` - 优先级模型
- `packages/scheduler/src/forks/Scheduler.js` - 调度器实现
- `packages/react-reconciler/src/ReactFiberBeginWork.js` - Fiber 开始工作
- `packages/react-reconciler/src/ReactFiberCompleteWork.js` - Fiber 完成工作

---

**上一篇**: [01 - JSX 和虚拟 DOM 原理](./01-JSX与虚拟DOM原理.md)
**下一篇**: [03 - Hooks 原理和实现](./03-Hooks原理与实现.md)
