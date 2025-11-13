# 04 - Diff 算法和渲染优化

## 核心概念

### 1. Diff 算法的三大策略

传统的树 Diff 算法复杂度是 O(n³)，React 通过三个假设将复杂度降低到 O(n)：

**策略 1：跨层级移动极少，只比较同级节点**
```
❌ 传统算法：比较所有可能的位置
✅ React：只比较同级
  A          A'
 / \        / \
B   C  vs  D   B    只比较 A-A'、B-D、C-B 三次
```

**策略 2：不同类型的元素产生不同的树**
```javascript
// type 不同，直接删除旧树，创建新树
<div>            <span>
  <Child />  →    <Child />  // Child 也会被销毁重建！
</div>           </span>
```

**策略 3：通过 key 标识在列表中的稳定性**
```javascript
// 有 key：可以复用
[A, B, C] → [B, A, C]  // 只移动位置

// 无 key：按顺序比较
[A, B, C] → [B, A, C]  // 全部更新
```

## 单节点 Diff

**场景**：新的子节点只有一个

**源码位置**：`packages/react-reconciler/src/ReactChildFiber.js`

```javascript
function reconcileSingleElement(
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  element: ReactElement,
): Fiber {
  const key = element.key;
  let child = currentFirstChild;

  // 1. 遍历旧的子节点列表
  while (child !== null) {
    // 1.1 比较 key
    if (child.key === key) {
      const elementType = element.type;

      // 1.2 key 相同，再比较 type
      if (child.elementType === elementType) {
        // key 和 type 都相同 → 复用节点
        deleteRemainingChildren(returnFiber, child.sibling);  // 删除其他兄弟节点

        const existing = useFiber(child, element.props);  // 复用 Fiber
        existing.return = returnFiber;
        return existing;
      }

      // key 相同但 type 不同 → 删除所有旧节点（不可能复用）
      deleteRemainingChildren(returnFiber, child);
      break;
    } else {
      // key 不同 → 删除当前节点，继续查找
      deleteChild(returnFiber, child);
    }
    child = child.sibling;
  }

  // 2. 没有找到可复用的节点，创建新节点
  const created = createFiberFromElement(element, returnFiber.mode, lanes);
  created.return = returnFiber;
  return created;
}
```

**流程图**：
```
新节点: <div key="a" />

旧节点列表: [<span key="a" />, <div key="b" />]

比较流程：
1. key="a" 相同？✅
2. type 相同？❌（span vs div）
3. 删除所有旧节点
4. 创建新节点
```

## 多节点 Diff

**场景**：新的子节点有多个（最复杂）

### 核心思想

多节点 Diff 分为两轮遍历：

**第一轮**：处理更新的节点
**第二轮**：处理新增、删除、移动的节点

```javascript
function reconcileChildrenArray(
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChildren: Array<any>,
  lanes: Lanes,
): Fiber | null {
  let resultingFirstChild: Fiber | null = null;
  let previousNewFiber: Fiber | null = null;

  let oldFiber = currentFirstChild;
  let lastPlacedIndex = 0;  // 最后一个可复用节点在旧列表中的位置
  let newIdx = 0;
  let nextOldFiber = null;

  // ===== 第一轮遍历：处理更新 =====
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    if (oldFiber.index > newIdx) {
      nextOldFiber = oldFiber;
      oldFiber = null;
    } else {
      nextOldFiber = oldFiber.sibling;
    }

    // 尝试复用节点（key 和 type 都相同）
    const newFiber = updateSlot(
      returnFiber,
      oldFiber,
      newChildren[newIdx],
      lanes,
    );

    if (newFiber === null) {
      // key 不同，跳出第一轮
      if (oldFiber === null) {
        oldFiber = nextOldFiber;
      }
      break;
    }

    if (shouldTrackSideEffects) {
      if (oldFiber && newFiber.alternate === null) {
        // 创建了新节点，删除旧节点
        deleteChild(returnFiber, oldFiber);
      }
    }

    // 放置节点
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);

    // 构建新 Fiber 链表
    if (previousNewFiber === null) {
      resultingFirstChild = newFiber;
    } else {
      previousNewFiber.sibling = newFiber;
    }
    previousNewFiber = newFiber;
    oldFiber = nextOldFiber;
  }

  // ===== 情况 1：新节点遍历完，删除剩余旧节点 =====
  if (newIdx === newChildren.length) {
    deleteRemainingChildren(returnFiber, oldFiber);
    return resultingFirstChild;
  }

  // ===== 情况 2：旧节点遍历完，新增剩余新节点 =====
  if (oldFiber === null) {
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
      if (newFiber === null) {
        continue;
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        resultingFirstChild = newFiber;
      } else {
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
    }
    return resultingFirstChild;
  }

  // ===== 第二轮遍历：处理移动、新增、删除 =====
  // 将剩余旧节点放入 Map（key → Fiber）
  const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

  for (; newIdx < newChildren.length; newIdx++) {
    const newFiber = updateFromMap(
      existingChildren,
      returnFiber,
      newIdx,
      newChildren[newIdx],
      lanes,
    );

    if (newFiber !== null) {
      if (shouldTrackSideEffects) {
        if (newFiber.alternate !== null) {
          // 复用了旧节点，从 Map 中删除
          existingChildren.delete(
            newFiber.key === null ? newIdx : newFiber.key,
          );
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        resultingFirstChild = newFiber;
      } else {
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
    }
  }

  if (shouldTrackSideEffects) {
    // 删除 Map 中剩余的旧节点（没有被复用）
    existingChildren.forEach(child => deleteChild(returnFiber, child));
  }

  return resultingFirstChild;
}
```

### placeChild - 判断是否需要移动

```javascript
function placeChild(
  newFiber: Fiber,
  lastPlacedIndex: number,
  newIndex: number,
): number {
  newFiber.index = newIndex;

  if (!shouldTrackSideEffects) {
    // 首次渲染，不需要移动
    return lastPlacedIndex;
  }

  const current = newFiber.alternate;
  if (current !== null) {
    // 复用节点
    const oldIndex = current.index;

    if (oldIndex < lastPlacedIndex) {
      // 旧位置 < 最后放置位置 → 需要移动
      newFiber.flags |= Placement;
      return lastPlacedIndex;
    } else {
      // 旧位置 >= 最后放置位置 → 不需要移动
      return oldIndex;
    }
  } else {
    // 新增节点
    newFiber.flags |= Placement;
    return lastPlacedIndex;
  }
}
```

### 多节点 Diff 示例

**示例 1：简单更新**
```javascript
// 旧: [A, B, C]
// 新: [A, B, D]

第一轮遍历：
- A: key 相同，type 相同 → 复用
- B: key 相同，type 相同 → 复用
- C vs D: key 不同 → 跳出

第二轮遍历：
- 删除 C
- 创建 D

结果: [A(复用), B(复用), D(新建)]
```

**示例 2：简单移动**
```javascript
// 旧: [A, B, C]  (index: 0, 1, 2)
// 新: [B, A, C]

第一轮遍历：
- B vs A: key 不同 → 跳出

第二轮遍历：
- 创建 Map: {A: Fiber(A, oldIndex=0), B: Fiber(B, oldIndex=1), C: Fiber(C, oldIndex=2)}
- 新[0]=B: 从 Map 找到 B，oldIndex=1，lastPlacedIndex=0
  - 1 >= 0 → 不移动，lastPlacedIndex=1
- 新[1]=A: 从 Map 找到 A，oldIndex=0，lastPlacedIndex=1
  - 0 < 1 → 需要移动！标记 Placement
- 新[2]=C: 从 Map 找到 C，oldIndex=2，lastPlacedIndex=1
  - 2 >= 1 → 不移动，lastPlacedIndex=2

结果: [B(不动), A(移动), C(不动)]
```

**示例 3：复杂移动**
```javascript
// 旧: [A, B, C, D]  (index: 0, 1, 2, 3)
// 新: [D, A, B, C]

第一轮：D vs A，key 不同 → 跳出

第二轮：
- Map: {A:0, B:1, C:2, D:3}
- 新[0]=D: oldIndex=3, lastPlacedIndex=0
  - 3 >= 0 → 不移动，lastPlacedIndex=3
- 新[1]=A: oldIndex=0, lastPlacedIndex=3
  - 0 < 3 → 移动！
- 新[2]=B: oldIndex=1, lastPlacedIndex=3
  - 1 < 3 → 移动！
- 新[3]=C: oldIndex=2, lastPlacedIndex=3
  - 2 < 3 → 移动！

结果: [D(不动), A(移动), B(移动), C(移动)]

优化思路：其实只需要把 D 移到最前面！
但 React 的算法是保持最右边稳定的节点不动，移动左边的节点。
```

## key 的作用

### 为什么需要 key？

```javascript
// 没有 key：按位置比较
旧: [<div>A</div>, <div>B</div>, <div>C</div>]
新: [<div>B</div>, <div>A</div>, <div>C</div>]

React 的比较：
- 位置 0: A → B (更新内容)
- 位置 1: B → A (更新内容)
- 位置 2: C → C (不变)
结果：两次更新 ❌

// 有 key：按 key 比较
旧: [<div key="a">A</div>, <div key="b">B</div>, <div key="c">C</div>]
新: [<div key="b">B</div>, <div key="a">A</div>, <div key="c">C</div>]

React 的比较：
- 找到 key="b" 的节点，复用并移动
- 找到 key="a" 的节点，复用并移动
- 找到 key="c" 的节点，复用不动
结果：只移动 DOM ✅
```

### key 使用 index 的问题

```javascript
// ❌ 错误：使用 index 作为 key
{items.map((item, index) => (
  <Item key={index} data={item} />
))}

// 问题示例
旧: [
  <Item key={0} data={{id: 1, name: 'A'}} />,
  <Item key={1} data={{id: 2, name: 'B'}} />,
  <Item key={2} data={{id: 3, name: 'C'}} />,
]

// 删除第一项后
新: [
  <Item key={0} data={{id: 2, name: 'B'}} />,  // key=0，但数据是 B！
  <Item key={1} data={{id: 3, name: 'C'}} />,  // key=1，但数据是 C！
]

// React 的判断：
// - key=0: 复用旧的 key=0 节点，更新 data (A → B)
// - key=1: 复用旧的 key=1 节点，更新 data (B → C)
// - key=2: 删除

// 结果：本应删除一个节点，实际更新了所有节点！❌

// ✅ 正确：使用稳定的 ID
{items.map(item => (
  <Item key={item.id} data={item} />
))}
```

## bailout 优化策略

**bailout** = 跳过更新（bail out of work）

React 在以下情况会跳过组件更新：

```javascript
// packages/react-reconciler/src/ReactFiberBeginWork.js

function bailoutOnAlreadyFinishedWork(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  // 1. 检查子节点是否需要更新
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // 子树没有更新 → 跳过整个子树！
    return null;
  }

  // 子树有更新 → 克隆子节点继续处理
  cloneChildFibers(current, workInProgress);
  return workInProgress.child;
}

// 触发 bailout 的条件
function beginWork(current, workInProgress, renderLanes) {
  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||  // props 没变
      hasLegacyContextChanged() ||  // context 没变
      workInProgress.type !== current.type  // type 没变
    ) {
      // 有变化，正常更新
    } else if (!includesSomeLane(renderLanes, renderLanes)) {
      // 优先级不够，bailout
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }

  // 正常更新流程
  // ...
}
```

### 优化技巧

**1. React.memo - 组件级别的 bailout**

```javascript
const ExpensiveComponent = React.memo(function ExpensiveComponent({ value }) {
  // 昂贵的计算或渲染
  return <div>{value}</div>;
});

// React.memo 会浅比较 props
// props 没变 → bailout，不重新渲染
```

**2. useMemo - 值级别的 bailout**

```javascript
function Component({ items }) {
  const sortedItems = useMemo(() => {
    console.log('sorting...');  // 只在 items 变化时执行
    return items.sort((a, b) => a - b);
  }, [items]);

  return <List items={sortedItems} />;
}
```

**3. useCallback - 函数级别的 bailout**

```javascript
function Parent() {
  const [count, setCount] = useState(0);
  const [otherState, setOtherState] = useState(0);

  // ❌ 每次渲染都创建新函数 → Child 总是重新渲染
  const handleClick = () => {
    setCount(c => c + 1);
  };

  // ✅ 使用 useCallback → otherState 变化时 Child 不重新渲染
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []);  // 依赖为空，函数引用永不变

  return <Child onClick={handleClick} />;
}

const Child = React.memo(({ onClick }) => {
  console.log('Child render');
  return <button onClick={onClick}>Click</button>;
});
```

## 高频面试题

### Q1: React 的 Diff 算法是如何工作的？

**答案**：

React 的 Diff 算法基于三个假设，将复杂度从 O(n³) 降低到 O(n)：

1. **同级比较**：只比较同一层级的节点，不跨层级比较
2. **类型相同才复用**：type 不同直接销毁重建
3. **key 标识稳定性**：通过 key 识别节点，避免不必要的更新

**具体流程**：

**单节点 Diff**：
1. 比较 key 是否相同
2. key 相同，再比较 type
3. 都相同则复用，否则删除重建

**多节点 Diff**（两轮遍历）：
1. **第一轮**：从头开始比较，遇到 key 不同就跳出
2. **第二轮**：处理移动、新增、删除
   - 将剩余旧节点建立 Map（key → Fiber）
   - 遍历剩余新节点，从 Map 中查找可复用的节点
   - 通过 `lastPlacedIndex` 判断是否需要移动

### Q2: 为什么列表渲染需要 key？

**答案**：

**key 的作用**：帮助 React 识别哪些元素发生了变化（新增、删除、移动）。

**没有 key 的问题**：
```javascript
// 旧: [A, B, C]
// 新: [B, C, A]

// 没有 key：按位置比较
位置 0: A → B (更新)
位置 1: B → C (更新)
位置 2: C → A (更新)
结果：全部更新 ❌

// 有 key：按 key 比较
key=A: 移动到末尾
key=B: 不动
key=C: 不动
结果：只移动一个节点 ✅
```

**key 的最佳实践**：
- ✅ 使用稳定的 ID：`key={item.id}`
- ❌ 不要使用 index：`key={index}`（除非列表永不变化）
- ❌ 不要使用随机数：`key={Math.random()}`（每次都重建）

### Q3: key 使用 index 有什么问题？

**答案**：

使用 index 作为 key 会导致以下问题：

**1. 性能问题**：
```javascript
items = [{id: 1, name: 'A'}, {id: 2, name: 'B'}];

// 删除第一项
items = [{id: 2, name: 'B'}];

// 使用 index 作为 key
旧: [<Item key={0} id={1} />, <Item key={1} id={2} />]
新: [<Item key={0} id={2} />]

// React 的判断：
// - key=0: 复用，但 id 变了 (1 → 2) → 更新组件 ❌
// - key=1: 删除

// 结果：本应删除一个，实际更新了一个 + 删除了一个
```

**2. 状态错乱**：
```javascript
function TodoList() {
  const [todos, setTodos] = useState([
    {id: 1, text: 'A'},
    {id: 2, text: 'B'},
  ]);

  return todos.map((todo, index) => (
    <TodoItem key={index} initialText={todo.text} />  // ❌ 使用 index
  ));
}

function TodoItem({ initialText }) {
  const [text, setText] = useState(initialText);  // 本地状态
  return <input value={text} onChange={e => setText(e.target.value)} />;
}

// 问题：删除第一项后，第二项的输入框内容会显示到第一项！
// 因为 React 认为 key=0 的组件还是 key=0，只是 props 变了
// 但本地状态 text 没有重置！
```

**正确的做法**：
```javascript
todos.map(todo => (
  <TodoItem key={todo.id} initialText={todo.text} />  // ✅ 使用 id
))
```

### Q4: React 如何判断组件是否需要更新？

**答案**：

React 通过以下条件判断组件是否需要更新（bailout）：

**1. props 是否变化**（浅比较）
```javascript
oldProps === newProps  // 引用相等 → bailout
```

**2. state 是否变化**
```javascript
// useState/useReducer 内部用 Object.is 比较
Object.is(oldState, newState)  // 相等 → bailout
```

**3. context 是否变化**
```javascript
oldContextValue === newContextValue  // 相等 → bailout
```

**4. 优先级是否足够**
```javascript
!includesSomeLane(renderLanes, workInProgress.childLanes)  // 不包含 → bailout
```

**优化手段**：

```javascript
// 1. React.memo：props 没变就 bailout
const Child = React.memo(function Child({ value }) {
  return <div>{value}</div>;
});

// 2. PureComponent：浅比较 props 和 state
class Child extends React.PureComponent {
  render() {
    return <div>{this.props.value}</div>;
  }
}

// 3. shouldComponentUpdate：自定义比较逻辑
class Child extends React.Component {
  shouldComponentUpdate(nextProps, nextState) {
    return this.props.value !== nextProps.value;
  }

  render() {
    return <div>{this.props.value}</div>;
  }
}
```

## 总结

1. **Diff 算法基于三个假设**：同级比较、类型不同重建、key 标识稳定性
2. **单节点 Diff**：比较 key 和 type，决定复用或重建
3. **多节点 Diff**：两轮遍历，处理更新、移动、新增、删除
4. **key 的作用**：帮助 React 识别节点，避免不必要的更新
5. **bailout 优化**：跳过不需要更新的组件，提升性能

## 相关源码文件

- `packages/react-reconciler/src/ReactChildFiber.js` - Diff 算法实现
- `packages/react-reconciler/src/ReactFiberBeginWork.js` - 组件更新开始阶段
- `packages/react-reconciler/src/ReactFiberCompleteWork.js` - 组件更新完成阶段

---

**上一篇**: [03 - Hooks 原理和实现](./03-Hooks原理与实现.md)
**下一篇**: [05 - 事件系统和合成事件](./05-事件系统与合成事件.md)
