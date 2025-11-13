# 03 - Hooks 原理和实现

## 核心概念

### 1. Hooks 的设计动机

React 16.8 引入 Hooks，解决了类组件的诸多问题：

**类组件的问题**：
1. **复杂的生命周期**：相关逻辑分散在不同生命周期方法中
2. **this 指向问题**：需要手动绑定或使用箭头函数
3. **难以复用状态逻辑**：HOC 和 Render Props 导致"嵌套地狱"
4. **类的学习成本**：需要理解 JavaScript 的 class 和 this

**Hooks 的优势**：
```javascript
// 类组件 - 逻辑分散
class Counter extends React.Component {
  constructor(props) {
    super(props);
    this.state = { count: 0 };
  }

  componentDidMount() {
    document.title = `You clicked ${this.state.count} times`;
  }

  componentDidUpdate() {
    document.title = `You clicked ${this.state.count} times`;  // 重复！
  }

  render() {
    return (
      <button onClick={() => this.setState({ count: this.state.count + 1 })}>
        Click me
      </button>
    );
  }
}

// 函数组件 + Hooks - 逻辑集中
function Counter() {
  const [count, setCount] = useState(0);

  // 相关逻辑放在一起
  useEffect(() => {
    document.title = `You clicked ${count} times`;
  }, [count]);

  return <button onClick={() => setCount(count + 1)}>Click me</button>;
}
```

### 2. Hooks 的数据结构

Hooks 在 Fiber 节点上以**单向链表**的形式存储。

```javascript
// Fiber 节点上的 Hooks 链表
fiber.memoizedState = {
  // Hook 1: useState
  memoizedState: 0,           // 当前状态值
  baseState: 0,               // 基础状态
  queue: UpdateQueue,         // 更新队列
  baseQueue: null,            // 基础更新队列
  next: {                     // 指向下一个 Hook
    // Hook 2: useEffect
    memoizedState: {
      create: () => {...},    // effect 函数
      destroy: undefined,     // 清理函数
      deps: [count],          // 依赖数组
      // ...
    },
    next: {                   // 指向下一个 Hook
      // Hook 3: useMemo
      // ...
    }
  }
};
```

**为什么是链表？**
1. **顺序固定**：Hooks 必须按相同顺序调用
2. **高效遍历**：按顺序遍历所有 Hooks
3. **易于添加**：在链表末尾追加新 Hook

## useState 和 useReducer 的实现

### Hook 对象的结构

```javascript
// packages/react-reconciler/src/ReactFiberHooks.js

type Hook = {
  memoizedState: any,          // 当前状态（对于 useState 是状态值，对于 useEffect 是 effect 对象）
  baseState: any,              // 计算新状态的基础状态
  baseQueue: Update<any> | null, // 基础更新队列
  queue: UpdateQueue<any> | null, // 更新队列
  next: Hook | null,           // 下一个 Hook
};

type UpdateQueue<S, A> = {
  pending: Update<S, A> | null, // 待处理的更新（环形链表）
  lanes: Lanes,                 // 更新的优先级
  dispatch: ((A) => mixed) | null, // dispatch 函数（即 setState）
  lastRenderedReducer: ((S, A) => S) | null, // 上次渲染使用的 reducer
  lastRenderedState: S | null,  // 上次渲染的状态
};
```

### useState 的实现原理

```javascript
// 简化版 useState 实现
function useState(initialState) {
  // 获取或创建 Hook 对象
  const hook = mountWorkInProgressHook();  // 首次渲染
  // 或 updateWorkInProgressHook();        // 更新渲染

  // 初始化状态
  if (typeof initialState === 'function') {
    initialState = initialState();  // 支持惰性初始化
  }
  hook.memoizedState = initialState;
  hook.baseState = initialState;

  // 创建更新队列
  const queue = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,  // (state, action) => action
    lastRenderedState: initialState,
  };
  hook.queue = queue;

  // 创建 dispatch 函数（绑定到当前 Fiber 和 queue）
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  queue.dispatch = dispatch;

  return [hook.memoizedState, dispatch];
}

// basicStateReducer：useState 的默认 reducer
function basicStateReducer(state, action) {
  // 支持函数式更新：setState(prevState => prevState + 1)
  return typeof action === 'function' ? action(state) : action;
}
```

### dispatch (setState) 的执行过程

```javascript
function dispatchSetState(fiber, queue, action) {
  // 1. 创建 update 对象
  const update = {
    lane,                    // 优先级
    revertLane: NoLane,
    action,                  // 新状态或更新函数
    hasEagerState: false,    // 是否已计算出新状态
    eagerState: null,        // 预计算的新状态
    next: null,              // 下一个 update（环形链表）
  };

  // 2. 将 update 加入队列（环形链表）
  const pending = queue.pending;
  if (pending === null) {
    // 第一个 update，形成环
    update.next = update;
  } else {
    // 插入到环中
    update.next = pending.next;
    pending.next = update;
  }
  queue.pending = update;

  // 3. 优化：尝试在渲染前计算新状态
  const alternate = fiber.alternate;
  if (
    fiber.lanes === NoLanes &&
    (alternate === null || alternate.lanes === NoLanes)
  ) {
    // 当前没有正在进行的更新，可以立即计算
    const lastRenderedReducer = queue.lastRenderedReducer;
    if (lastRenderedReducer !== null) {
      try {
        const currentState = queue.lastRenderedState;
        const eagerState = lastRenderedReducer(currentState, action);

        update.hasEagerState = true;
        update.eagerState = eagerState;

        // 如果新状态和旧状态相同，跳过渲染（优化！）
        if (Object.is(eagerState, currentState)) {
          return;  // 不触发更新
        }
      } catch (error) {
        // 忽略错误，在渲染时再处理
      }
    }
  }

  // 4. 调度更新
  scheduleUpdateOnFiber(fiber, lane);
}
```

### 更新时计算新状态

```javascript
function updateReducer(reducer, initialArg, init) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;

  queue.lastRenderedReducer = reducer;

  // 1. 获取当前的 baseState 和 baseQueue
  let baseQueue = hook.baseQueue;
  const pendingQueue = queue.pending;

  // 2. 合并 pending updates 到 baseQueue
  if (pendingQueue !== null) {
    // 将环形链表展开并合并
    if (baseQueue !== null) {
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }
    hook.baseQueue = baseQueue = pendingQueue;
    queue.pending = null;
  }

  // 3. 遍历 baseQueue，计算新状态
  if (baseQueue !== null) {
    const first = baseQueue.next;
    let newState = hook.baseState;

    let update = first;
    do {
      const updateLane = update.lane;

      // 检查优先级，决定是否应用此 update
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // 优先级不够，跳过此 update（会在下次高优先级渲染时处理）
        // ...
      } else {
        // 应用 update
        if (update.hasEagerState) {
          // 使用预计算的状态
          newState = update.eagerState;
        } else {
          const action = update.action;
          newState = reducer(newState, action);
        }
      }

      update = update.next;
    } while (update !== null && update !== first);

    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueueLast;

    queue.lastRenderedState = newState;
  }

  const dispatch = queue.dispatch;
  return [hook.memoizedState, dispatch];
}
```

## useEffect 的实现

### Effect 对象的结构

```javascript
type Effect = {
  tag: HookFlags,              // effect 类型标记（Passive、Layout 等）
  create: () => (() => void) | void,  // effect 函数
  destroy: (() => void) | void,       // 清理函数（effect 返回值）
  deps: Array<mixed> | null,   // 依赖数组
  next: Effect,                // 下一个 effect（环形链表）
};
```

### mountEffect - 首次渲染

```javascript
function mountEffect(create, deps) {
  // 1. 创建 Hook 对象
  const hook = mountWorkInProgressHook();

  const nextDeps = deps === undefined ? null : deps;

  // 2. 标记 Fiber 需要执行副作用
  currentlyRenderingFiber.flags |= PassiveEffect | PassiveStaticEffect;

  // 3. 创建 effect 对象并添加到 Fiber 的 updateQueue
  hook.memoizedState = pushEffect(
    HookHasEffect | HookPassive,  // 标记：有副作用 + Passive 类型
    create,
    undefined,     // destroy（首次渲染时为 undefined）
    nextDeps,
  );
}

function pushEffect(tag, create, destroy, deps) {
  const effect: Effect = {
    tag,
    create,
    destroy,
    deps,
    next: null,
  };

  // 获取 Fiber 的 effect 链表
  let componentUpdateQueue = currentlyRenderingFiber.updateQueue;
  if (componentUpdateQueue === null) {
    // 创建新的 updateQueue
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = componentUpdateQueue;
    componentUpdateQueue.lastEffect = effect.next = effect;  // 环形链表
  } else {
    // 添加到链表末尾
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }

  return effect;
}
```

### updateEffect - 更新渲染

```javascript
function updateEffect(create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy = undefined;

  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;

    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;

      // 比较依赖：如果依赖没变，不执行 effect
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        // 不加 HookHasEffect 标记 → 不会执行
        hook.memoizedState = pushEffect(HookPassive, create, destroy, nextDeps);
        return;
      }
    }
  }

  // 依赖变化了，标记需要执行 effect
  currentlyRenderingFiber.flags |= PassiveEffect;
  hook.memoizedState = pushEffect(
    HookHasEffect | HookPassive,
    create,
    destroy,
    nextDeps,
  );
}

// 比较依赖数组
function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) {
    return false;
  }

  // 逐个比较（使用 Object.is）
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}
```

### useEffect 的执行时机

```javascript
// Commit 阶段的处理流程：

// 1. Before Mutation 阶段：DOM 变更前
commitBeforeMutationEffects(finishedWork);

// 2. Mutation 阶段：执行 DOM 操作
commitMutationEffects(finishedWork, root);

// 3. Layout 阶段：DOM 变更后（同步）
//    - useLayoutEffect 在这里执行
commitLayoutEffects(finishedWork, root);

// 4. 浏览器绘制

// 5. Passive 阶段：绘制后（异步）
//    - useEffect 在这里执行
scheduleCallback(NormalPriority, () => {
  flushPassiveEffects();  // 异步执行 useEffect
});

// flushPassiveEffects 的实现
function flushPassiveEffects() {
  // 1. 先执行所有 effect 的清理函数（destroy）
  commitPassiveUnmountEffects(root.current);

  // 2. 再执行所有新的 effect 函数（create）
  commitPassiveMountEffects(root, root.current);
}
```

## useCallback 和 useMemo 的实现

### useMemo - 记忆化值

```javascript
function mountMemo(nextCreate, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;

  // 首次渲染：执行计算函数
  const nextValue = nextCreate();

  // 保存值和依赖
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateMemo(nextCreate, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps = prevState[1];

      // 依赖没变，返回缓存的值
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }

  // 依赖变化，重新计算
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}
```

### useCallback - 记忆化函数

```javascript
function mountCallback(callback, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;

  // 保存函数和依赖
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps = prevState[1];

      // 依赖没变，返回缓存的函数
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }

  // 依赖变化，返回新函数
  hook.memoizedState = [callback, nextDeps];
  return callback;
}
```

**useCallback 和 useMemo 的关系**：
```javascript
// useCallback(fn, deps) 等价于：
useMemo(() => fn, deps)
```

## 高频面试题

### Q1: Hooks 为什么不能在条件语句中使用？

**答案**：

Hooks 必须在组件顶层、按固定顺序调用，因为 **React 依赖 Hooks 的调用顺序来匹配 Hook 对象**。

```javascript
function Component({ condition }) {
  // ❌ 错误：条件调用
  if (condition) {
    const [state, setState] = useState(0);  // Hook 1
  }
  const [count, setCount] = useState(0);    // Hook 2 或 Hook 1？

  // React 无法确定 count 对应哪个 Hook 对象！
}
```

**原理**：

```javascript
// 首次渲染（condition = true）
Hook 链表: Hook1(useState) → Hook2(useState) → null

// 二次渲染（condition = false）
// React 期望的链表: Hook1 → Hook2
// 实际的调用: 只有一个 useState

// 结果：Hook 匹配错乱！
// React 会把 Hook2 的数据给 count，导致状态错误
```

**React 的检查机制**：

```javascript
// packages/react-reconciler/src/ReactFiberHooks.js:503-565

function renderWithHooks(...) {
  // 区分 mount 和 update
  if (current === null || current.memoizedState === null) {
    ReactSharedInternals.H = HooksDispatcherOnMount;
  } else {
    ReactSharedInternals.H = HooksDispatcherOnUpdate;
  }

  // 渲染组件
  let children = Component(props, secondArg);

  // 检查 Hook 数量是否一致
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  if (didRenderTooFewHooks) {
    throw new Error('Rendered fewer hooks than expected.');
  }
}
```

### Q2: useState 的更新是同步还是异步？

**答案**：

**取决于触发更新的上下文**：

**1. 在 React 事件处理器中：批量更新（看起来是"异步"）**

```javascript
function Component() {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    console.log('before:', count);  // 0

    setCount(count + 1);  // 不会立即更新
    console.log('after:', count);   // 还是 0！

    setCount(count + 1);  // 基于旧值，结果还是 1
    console.log('after:', count);   // 还是 0！

    // React 会批量处理这两个 setState
    // 渲染后 count = 1（不是 2！）
  };

  return <button onClick={handleClick}>{count}</button>;
}

// 正确的写法：函数式更新
const handleClick = () => {
  setCount(c => c + 1);  // 基于最新值
  setCount(c => c + 1);  // 基于最新值
  // 渲染后 count = 2
};
```

**2. 在原生事件、setTimeout、Promise 中：React 17 不批量（同步更新）**

```javascript
function Component() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // 原生事件：React 17 不批量
    document.addEventListener('click', () => {
      setCount(c => c + 1);  // 触发一次渲染
      setCount(c => c + 1);  // 再触发一次渲染（共两次！）
    });

    // setTimeout：React 17 不批量
    setTimeout(() => {
      setCount(c => c + 1);  // 触发一次渲染
      setCount(c => c + 1);  // 再触发一次渲染（共两次！）
    }, 1000);
  }, []);

  return <div>{count}</div>;
}
```

**React 18 的改进：自动批量更新**

```javascript
// React 18：所有更新都会自动批量处理
setTimeout(() => {
  setCount(c => c + 1);
  setCount(c => c + 1);
  // 只触发一次渲染！
}, 1000);

// 如果需要立即更新（不批量）
import { flushSync } from 'react-dom';

flushSync(() => {
  setCount(c => c + 1);  // 立即渲染
});
setCount(c => c + 1);  // 再次渲染
```

### Q3: useEffect 和 useLayoutEffect 的区别？

**答案**：

两者的区别在于**执行时机**：

```
用户操作/状态更新
    ↓
Render 阶段（协调，可中断）
    ↓
Commit 阶段（提交，不可中断）
    ├─ Before Mutation
    ├─ Mutation（执行 DOM 操作）
    ├─ Layout ← useLayoutEffect 在这里（同步）
    ↓
浏览器绘制（Paint）
    ↓
Passive ← useEffect 在这里（异步）
```

**useEffect（异步，不阻塞渲染）**：

```javascript
useEffect(() => {
  // 在浏览器绘制后异步执行
  // 不阻塞浏览器渲染
  console.log('useEffect');
}, []);
```

**useLayoutEffect（同步，阻塞渲染）**：

```javascript
useLayoutEffect(() => {
  // 在浏览器绘制前同步执行
  // 阻塞浏览器渲染，直到执行完成
  console.log('useLayoutEffect');
}, []);
```

**使用场景**：

```javascript
// ✅ 大多数情况：使用 useEffect
useEffect(() => {
  // 数据获取
  fetchData();

  // 事件监听
  window.addEventListener('resize', handleResize);

  // 不影响布局的 DOM 操作
  document.title = 'New Title';
}, []);

// ✅ 需要同步读取/修改 DOM 布局时：使用 useLayoutEffect
useLayoutEffect(() => {
  // 读取 DOM 尺寸
  const height = ref.current.offsetHeight;

  // 根据尺寸设置其他元素的样式（避免闪烁）
  otherRef.current.style.top = `${height}px`;

  // 测量和定位（tooltip、popover 等）
}, []);
```

**案例：防止闪烁**

```javascript
function Component() {
  const ref = useRef();

  // ❌ 使用 useEffect：会看到闪烁
  useEffect(() => {
    ref.current.style.backgroundColor = 'red';
    // 用户先看到默认颜色，然后变红（闪烁）
  }, []);

  // ✅ 使用 useLayoutEffect：无闪烁
  useLayoutEffect(() => {
    ref.current.style.backgroundColor = 'red';
    // 在绘制前就设置好颜色，用户直接看到红色
  }, []);

  return <div ref={ref}>Hello</div>;
}
```

### Q4: 如何实现一个自定义 Hook？

**答案**：

自定义 Hook 是一个以 `use` 开头的函数，内部可以调用其他 Hooks。

**基本原则**：
1. 函数名以 `use` 开头
2. 可以调用其他 Hooks
3. 可以返回任何值
4. 用于提取和复用组件逻辑

**示例 1：useLocalStorage**

```javascript
function useLocalStorage(key, initialValue) {
  // 惰性初始化：只在首次渲染时读取 localStorage
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  // 封装 setValue，同时更新 state 和 localStorage
  const setValue = useCallback((value) => {
    try {
      // 支持函数式更新
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;

      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

// 使用
function App() {
  const [name, setName] = useLocalStorage('name', 'Alice');
  return <input value={name} onChange={(e) => setName(e.target.value)} />;
}
```

**示例 2：useDebounce**

```javascript
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // 设置定时器
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 清理函数：在下次 effect 执行前取消定时器
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);  // value 或 delay 变化时重新设置定时器

  return debouncedValue;
}

// 使用
function SearchComponent() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  useEffect(() => {
    // 只在用户停止输入 500ms 后才发送请求
    if (debouncedSearchTerm) {
      fetchSearchResults(debouncedSearchTerm);
    }
  }, [debouncedSearchTerm]);

  return (
    <input
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />
  );
}
```

**示例 3：useAsync**

```javascript
function useAsync(asyncFunction, immediate = true) {
  const [status, setStatus] = useState('idle');
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);

  // useCallback 确保 execute 函数引用稳定
  const execute = useCallback(() => {
    setStatus('pending');
    setValue(null);
    setError(null);

    return asyncFunction()
      .then((response) => {
        setValue(response);
        setStatus('success');
      })
      .catch((error) => {
        setError(error);
        setStatus('error');
      });
  }, [asyncFunction]);

  // 立即执行
  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return { execute, status, value, error };
}

// 使用
function UserProfile({ userId }) {
  const { status, value: user, error } = useAsync(
    () => fetchUser(userId),
    true  // 立即获取
  );

  if (status === 'pending') return <div>Loading...</div>;
  if (status === 'error') return <div>Error: {error.message}</div>;
  if (status === 'success') return <div>User: {user.name}</div>;
}
```

### Q5: 为什么不能在 useEffect 中直接使用 async 函数？

**答案**：

**不能这样写**：

```javascript
// ❌ 错误
useEffect(async () => {
  const data = await fetchData();
  setData(data);
}, []);
```

**原因**：

1. **useEffect 期望返回清理函数或 undefined**
2. **async 函数总是返回 Promise**
3. **React 会把 Promise 当作清理函数，导致警告或错误**

**正确的写法**：

```javascript
// ✅ 方法 1：在内部定义 async 函数
useEffect(() => {
  const fetchData = async () => {
    try {
      const response = await fetch('/api/data');
      const data = await response.json();
      setData(data);
    } catch (error) {
      setError(error);
    }
  };

  fetchData();
}, []);

// ✅ 方法 2：使用 IIFE（立即执行函数）
useEffect(() => {
  (async () => {
    try {
      const data = await fetchData();
      setData(data);
    } catch (error) {
      setError(error);
    }
  })();
}, []);

// ✅ 方法 3：带清理的版本
useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      const data = await fetchData();
      if (!cancelled) {  // 检查组件是否已卸载
        setData(data);
      }
    } catch (error) {
      if (!cancelled) {
        setError(error);
      }
    }
  })();

  // 清理函数
  return () => {
    cancelled = true;  // 防止在组件卸载后更新状态
  };
}, []);
```

## 总结

1. **Hooks 使用链表存储**，必须按固定顺序调用
2. **useState 的批量更新机制**提高性能
3. **useEffect 异步执行**，不阻塞浏览器渲染
4. **useLayoutEffect 同步执行**，用于 DOM 测量和布局
5. **useCallback 和 useMemo** 用于性能优化，避免不必要的重渲染
6. **自定义 Hooks** 用于提取和复用组件逻辑

## 相关源码文件

- `packages/react-reconciler/src/ReactFiberHooks.js` - Hooks 实现
- `packages/react/src/ReactHooks.js` - Hooks API 定义
- `packages/react-reconciler/src/ReactFiberCommitWork.js` - Effect 执行

---

**上一篇**: [02 - Fiber 架构和调度原理](./02-Fiber架构与调度原理.md)
**下一篇**: [04 - Diff 算法和渲染优化](./04-Diff算法与渲染优化.md)
