# 06 - 状态管理和 Context

## Context 的实现原理

### 1. Context 的基本用法

```javascript
// 创建 Context
const ThemeContext = React.createContext('light');

// Provider 提供值
function App() {
  const [theme, setTheme] = useState('dark');

  return (
    <ThemeContext.Provider value={theme}>
      <Child />
    </ThemeContext.Provider>
  );
}

// Consumer 消费值
function Child() {
  const theme = useContext(ThemeContext);
  return <div>Current theme: {theme}</div>;
}
```

### 2. createContext 的实现

```javascript
// packages/react/src/ReactContext.js

export function createContext<T>(defaultValue: T): ReactContext<T> {
  const context: ReactContext<T> = {
    $$typeof: REACT_CONTEXT_TYPE,

    // Provider 和 Consumer 是两个不同的对象
    _currentValue: defaultValue,   // 当前值（用于单个渲染器）
    _currentValue2: defaultValue,  // 备用值（用于并发渲染器）

    Provider: null,
    Consumer: null,
  };

  // 创建 Provider
  context.Provider = {
    $$typeof: REACT_PROVIDER_TYPE,
    _context: context,
  };

  // 创建 Consumer（向后兼容）
  context.Consumer = context;

  return context;
}
```

### 3. Provider 的工作原理

```javascript
// packages/react-reconciler/src/ReactFiberBeginWork.js

function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const context = workInProgress.type._context;
  const newProps = workInProgress.pendingProps;
  const oldProps = current !== null ? current.memoizedProps : null;

  const newValue = newProps.value;

  // 1. 推入新值到 value stack
  pushProvider(workInProgress, context, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;

    // 2. 比较新旧值
    if (Object.is(oldValue, newValue)) {
      // 值没变，检查 children 是否相同
      if (oldProps.children === newProps.children) {
        // 可以 bailout（跳过子树）
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );
      }
    } else {
      // 3. 值变了，标记所有消费此 Context 的组件需要更新
      propagateContextChange(workInProgress, context, renderLanes);
    }
  }

  // 4. 渲染 children
  const newChildren = newProps.children;
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

// 传播 Context 变化
function propagateContextChange(
  workInProgress: Fiber,
  context: ReactContext<mixed>,
  renderLanes: Lanes,
): void {
  let fiber = workInProgress.child;

  while (fiber !== null) {
    // 查找消费此 Context 的组件
    let list = fiber.dependencies;
    if (list !== null) {
      let dependency = list.firstContext;
      while (dependency !== null) {
        // 检查是否依赖当前 Context
        if (dependency.context === context) {
          // 标记需要更新
          if (fiber.tag === ClassComponent) {
            // 类组件：创建强制更新
            const lane = pickArbitraryLane(renderLanes);
            const update = createUpdate(lane);
            update.tag = ForceUpdate;
            enqueueUpdate(fiber, update, lane);
          }

          // 合并优先级
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }

          // 标记祖先链
          scheduleContextWorkOnParentPath(
            fiber.return,
            renderLanes,
            workInProgress,
          );

          // 标记依赖链
          list.lanes = mergeLanes(list.lanes, renderLanes);
          break;
        }
        dependency = dependency.next;
      }
    }

    // 继续遍历子树
    fiber = fiber.child;
  }
}
```

### 4. useContext 的实现

```javascript
// packages/react-reconciler/src/ReactFiberHooks.js

function readContext<T>(context: ReactContext<T>): T {
  const value = context._currentValue;

  // 创建依赖关系
  const contextItem = {
    context: context,
    memoizedValue: value,
    next: null,
  };

  if (lastContextDependency === null) {
    // 第一个 Context 依赖
    lastContextDependency = contextItem;
    currentlyRenderingFiber.dependencies = {
      lanes: NoLanes,
      firstContext: contextItem,
    };
  } else {
    // 添加到链表末尾
    lastContextDependency = lastContextDependency.next = contextItem;
  }

  return value;
}

export function useContext<T>(context: ReactContext<T>): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useContext(context);
}
```

## Context 性能问题

### 1. Context 导致的重渲染

```javascript
// ❌ 问题：所有消费 Context 的组件都会重新渲染
const AppContext = React.createContext();

function App() {
  const [user, setUser] = useState({ name: 'Alice' });
  const [theme, setTheme] = useState('dark');

  return (
    <AppContext.Provider value={{ user, theme, setUser, setTheme }}>
      <Header />    {/* 重渲染 */}
      <Content />   {/* 重渲染 */}
      <Footer />    {/* 重渲染 */}
    </AppContext.Provider>
  );
}

// 即使 Footer 只用 theme，user 变化时也会重渲染
function Footer() {
  const { theme } = useContext(AppContext);
  return <div>Theme: {theme}</div>;
}
```

### 2. 优化方案

**方案 1：拆分 Context**
```javascript
// ✅ 拆分成多个 Context
const UserContext = React.createContext();
const ThemeContext = React.createContext();

function App() {
  const [user, setUser] = useState({ name: 'Alice' });
  const [theme, setTheme] = useState('dark');

  return (
    <UserContext.Provider value={{ user, setUser }}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <Header />
        <Content />
        <Footer />    {/* 只在 theme 变化时重渲染 */}
      </ThemeContext.Provider>
    </UserContext.Provider>
  );
}

function Footer() {
  const { theme } = useContext(ThemeContext);  // 只订阅 theme
  return <div>Theme: {theme}</div>;
}
```

**方案 2：使用 useMemo 缓存 value**
```javascript
function App() {
  const [user, setUser] = useState({ name: 'Alice' });
  const [theme, setTheme] = useState('dark');

  // ✅ 缓存 value 对象
  const userContextValue = useMemo(() => ({ user, setUser }), [user]);
  const themeContextValue = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <UserContext.Provider value={userContextValue}>
      <ThemeContext.Provider value={themeContextValue}>
        <App />
      </ThemeContext.Provider>
    </UserContext.Provider>
  );
}
```

**方案 3：组件级别的 memo**
```javascript
// ✅ 使用 React.memo 避免不必要的重渲染
const Footer = React.memo(function Footer() {
  const { theme } = useContext(ThemeContext);
  console.log('Footer render');
  return <div>Theme: {theme}</div>;
});

// 即使父组件重渲染，Footer 只在 theme 变化时重渲染
```

**方案 4：使用 children 技巧**
```javascript
function App() {
  const [count, setCount] = useState(0);

  return (
    <CountContext.Provider value={count}>
      <div>
        <button onClick={() => setCount(c => c + 1)}>Increment</button>
        {/* ✅ 将不需要 Context 的组件作为 children 传入 */}
        <Layout>
          <ExpensiveComponent />  {/* 不会因为 count 变化而重渲染 */}
        </Layout>
      </div>
    </CountContext.Provider>
  );
}

function Layout({ children }) {
  const count = useContext(CountContext);
  return (
    <div>
      Count: {count}
      {children}  {/* children 是稳定的引用 */}
    </div>
  );
}
```

## 状态管理库的选择

### Redux vs Context

**Redux 的优势**：
1. **单一数据源**：所有状态在一个 store
2. **可预测性**：纯函数 reducer，易于测试
3. **时间旅行调试**：Redux DevTools
4. **中间件系统**：处理异步、日志等
5. **性能优化**：`connect` 可以精确订阅状态切片

**Context 的优势**：
1. **零依赖**：React 内置
2. **简单直观**：API 简单，学习成本低
3. **灵活**：可以多个 Context 共存
4. **TypeScript 友好**：类型推断更好

**使用场景**：

```javascript
// ✅ 适合 Context：
// - 简单的全局状态（主题、语言、用户信息）
// - 不频繁变化的数据
// - 组件树的依赖注入

// ✅ 适合 Redux：
// - 复杂的应用状态
// - 需要时间旅行调试
// - 需要中间件（saga、thunk）
// - 跨多个组件树共享状态
```

### Zustand - 轻量级状态管理

```javascript
// Zustand：简洁的 API
import create from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

function Counter() {
  const count = useStore((state) => state.count);  // 精确订阅
  const increment = useStore((state) => state.increment);

  return (
    <div>
      <div>{count}</div>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

### Jotai - 原子化状态管理

```javascript
// Jotai：原子化的状态
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);
const doubleAtom = atom((get) => get(countAtom) * 2);

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  const [double] = useAtom(doubleAtom);

  return (
    <div>
      <div>Count: {count}</div>
      <div>Double: {double}</div>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
```

## 高频面试题

### Q1: Context 如何实现跨组件通信？

**答案**：

Context 通过 **Provider-Consumer 模式** 实现跨组件通信：

**1. 创建 Context**
```javascript
const MyContext = React.createContext(defaultValue);
```

**2. Provider 提供值**
```javascript
<MyContext.Provider value={someValue}>
  <ChildComponents />
</MyContext.Provider>
```

**3. 消费值**
```javascript
// 方式 1：useContext Hook
const value = useContext(MyContext);

// 方式 2：Consumer 组件（旧方式）
<MyContext.Consumer>
  {value => <div>{value}</div>}
</MyContext.Consumer>

// 方式 3：contextType（类组件）
class MyComponent extends React.Component {
  static contextType = MyContext;
  render() {
    return <div>{this.context}</div>;
  }
}
```

**工作原理**：
1. Provider 将值存储在 `context._currentValue`
2. 消费组件通过 `readContext` 读取值，并建立依赖关系
3. Provider 的值变化时，React 遍历子树，标记所有消费此 Context 的组件需要更新
4. 触发重新渲染

### Q2: Context 有什么性能问题？如何优化？

**答案**：

**性能问题**：

1. **所有消费者都会重渲染**
```javascript
// value 对象每次都是新的
<Context.Provider value={{ user, theme }}>
  <Child />  {/* 每次都重渲染，即使 user 和 theme 没变 */}
</Context.Provider>
```

2. **无法精确订阅**
```javascript
// 即使只用 theme，user 变化也会重渲染
const { theme } = useContext(Context);
```

**优化方案**：

**1. 拆分 Context**
```javascript
// 将不同关注点拆分到不同 Context
<UserContext.Provider value={user}>
  <ThemeContext.Provider value={theme}>
    <App />
  </ThemeContext.Provider>
</UserContext.Provider>
```

**2. 使用 useMemo**
```javascript
const value = useMemo(() => ({ user, theme }), [user, theme]);
<Context.Provider value={value}>
```

**3. 使用 React.memo**
```javascript
const Child = React.memo(function Child({ otherProp }) {
  const context = useContext(MyContext);
  // 只在 context 或 otherProp 变化时重渲染
});
```

**4. 将不需要 Context 的组件提取为 children**
```javascript
<Provider value={value}>
  <Layout>
    <ExpensiveComponent />  {/* 作为 children，不受 Provider 影响 */}
  </Layout>
</Provider>
```

### Q3: 什么时候需要使用状态管理库？

**答案**：

**使用 Context + Hooks 的场景**：
- 简单的全局状态（主题、语言、认证）
- 不频繁更新的数据
- 组件树较浅
- 状态逻辑简单

**使用状态管理库（Redux、Zustand）的场景**：
1. **复杂的状态逻辑**：多个 action、复杂的更新逻辑
2. **需要时间旅行调试**：Redux DevTools
3. **需要中间件**：处理异步、日志、持久化
4. **跨多个组件树共享状态**：微前端、iframe
5. **需要精确的性能控制**：避免不必要的重渲染
6. **团队协作**：统一的状态管理模式

**选择指南**：
```
简单应用
  ↓
useState + props
  ↓ (需要跨多层传递)
useContext
  ↓ (状态变复杂)
Zustand / Jotai（轻量）
  ↓ (需要调试工具/中间件)
Redux（完整方案）
```

### Q4: Redux 和 Context 的区别？

**答案**：

| 对比维度 | Context | Redux |
|---------|---------|-------|
| **性能** | 所有消费者都重渲染 | `connect` 可精确订阅 |
| **调试** | 无专用工具 | Redux DevTools 强大 |
| **中间件** | 无 | saga、thunk 等丰富生态 |
| **学习曲线** | 简单 | 较陡峭 |
| **代码量** | 少 | 多（action、reducer、store） |
| **TypeScript** | 类型推断好 | 需要额外类型定义 |
| **异步处理** | 需要自己实现 | 中间件支持 |

**代码对比**：

```javascript
// Context 实现 counter
const CountContext = React.createContext();

function CountProvider({ children }) {
  const [count, setCount] = useState(0);
  const value = useMemo(
    () => ({ count, setCount }),
    [count]
  );
  return <CountContext.Provider value={value}>{children}</CountContext.Provider>;
}

function useCount() {
  return useContext(CountContext);
}

// Redux 实现 counter
// actions.js
const increment = () => ({ type: 'INCREMENT' });

// reducer.js
function counterReducer(state = { count: 0 }, action) {
  switch (action.type) {
    case 'INCREMENT':
      return { count: state.count + 1 };
    default:
      return state;
  }
}

// store.js
const store = createStore(counterReducer);

// component.js
function Counter() {
  const count = useSelector(state => state.count);
  const dispatch = useDispatch();
  return <button onClick={() => dispatch(increment())}>{count}</button>;
}
```

## 总结

1. **Context 基于 Provider-Consumer 模式**，实现跨组件通信
2. **Context 的性能问题**：所有消费者都会重渲染
3. **优化手段**：拆分 Context、useMemo、React.memo、children 技巧
4. **状态管理库的选择**：根据应用复杂度和团队需求
5. **Redux 适合复杂应用**，Context 适合简单场景

## 相关源码文件

- `packages/react/src/ReactContext.js` - Context 创建
- `packages/react-reconciler/src/ReactFiberBeginWork.js` - Provider 更新
- `packages/react-reconciler/src/ReactFiberHooks.js` - useContext 实现

---

**上一篇**: [05 - 事件系统和合成事件](./05-事件系统与合成事件.md)
**下一篇**: [07 - 性能优化最佳实践](./07-性能优化最佳实践.md)
