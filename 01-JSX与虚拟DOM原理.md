# 01 - JSX 和虚拟 DOM 原理

## 核心概念

### 1. JSX 是什么？

JSX（JavaScript XML）是 React 提供的一种语法糖，允许我们在 JavaScript 中编写类似 HTML 的标记语言。

**本质**：JSX 并不是一种新的语言，而是会被编译器（如 Babel）转换为普通的 JavaScript 函数调用。

### 2. JSX 的编译过程

#### React 17 之前（旧的 JSX 转换）

```jsx
// 编写的 JSX
<div className="container">
  <h1>Hello, {name}</h1>
</div>

// 编译后
React.createElement(
  'div',
  { className: 'container' },
  React.createElement('h1', null, 'Hello, ', name)
)
```

#### React 17 新的 JSX 转换

React 17 引入了新的 JSX 转换，不再需要显式导入 React：

```jsx
// 编写的 JSX
<div className="container">
  <h1>Hello, {name}</h1>
</div>

// 编译后（自动导入 jsx-runtime）
import { jsx as _jsx } from 'react/jsx-runtime';

_jsx('div', {
  className: 'container',
  children: _jsx('h1', { children: ['Hello, ', name] })
})
```

**优势**：
- 不需要手动导入 React
- 生成的代码更小
- 编译性能更好

## 源码分析

### 1. ReactElement 的创建

**位置**：`packages/react/src/jsx/ReactJSXElement.js:169-282`

```javascript
/**
 * React Element 的工厂方法
 * 不再遵循类模式，不要使用 new 调用
 */
function ReactElement(type, key, props, owner, debugStack, debugTask) {
  const refProp = props.ref;
  const ref = refProp !== undefined ? refProp : null;

  let element;

  // 开发环境
  if (__DEV__) {
    element = {
      // 标识这是一个 React Element
      $$typeof: REACT_ELEMENT_TYPE,  // Symbol('react.element')

      // 元素的核心属性
      type,   // 组件类型（函数组件、类组件、或 DOM 标签字符串）
      key,    // 用于 Diff 算法的唯一标识
      props,  // 传递给组件的所有属性（包括 children）

      // 记录创建此元素的组件（用于调试）
      _owner: owner,
    };
  } else {
    // 生产环境：更简洁的结构
    element = {
      $$typeof: REACT_ELEMENT_TYPE,
      type,
      key,
      ref,
      props,
    };
  }

  return element;
}
```

**关键点**：
- `$$typeof` 用于安全地标识 React 元素，防止 XSS 攻击
- `type` 可以是字符串（DOM 标签）或函数/类（组件）
- `props` 包含了所有传递给组件的属性，包括 `children`
- `key` 是 React 内部使用的，不会传递给组件

### 2. JSX 转换函数 - jsxProd

**位置**：`packages/react/src/jsx/ReactJSXElement.js:290+`

```javascript
/**
 * React 17+ 新的 JSX 转换（生产环境）
 */
export function jsxProd(type, config, maybeKey) {
  let key = null;

  // 处理 key
  if (maybeKey !== undefined) {
    key = '' + maybeKey;  // 强制转换为字符串
  }

  // 从 config 中提取 key
  if (hasValidKey(config)) {
    key = '' + config.key;
  }

  // 构建 props 对象（排除 key 和 ref）
  const props = {};
  for (const propName in config) {
    if (
      hasOwnProperty.call(config, propName) &&
      // 排除内部属性
      propName !== 'key' &&
      propName !== '__self' &&
      propName !== '__source'
    ) {
      props[propName] = config[propName];
    }
  }

  // 创建并返回 React Element
  return ReactElement(
    type,
    key,
    props,
    getOwner(),      // 获取当前组件
    undefined,       // debugStack
    undefined        // debugTask
  );
}
```

## 虚拟 DOM 的数据结构

### ReactElement vs Fiber

很多人容易混淆 ReactElement 和 Fiber，它们的区别是：

#### ReactElement（虚拟 DOM）

```javascript
{
  $$typeof: Symbol(react.element),
  type: 'div',              // 或组件函数/类
  key: 'unique-key',
  props: {
    className: 'container',
    children: [...]
  },
  ref: null,
  _owner: FiberNode,        // 仅在 DEV 环境
}
```

**特点**：
- **轻量**：只描述"是什么"
- **不可变**：每次渲染都创建新的对象
- **简单**：只包含必要的描述信息

#### Fiber Node（工作单元）

Fiber 是 React 内部用于协调和调度的数据结构，包含更多信息：

```javascript
{
  // 类型信息
  tag: WorkTag,              // 标识节点类型（函数组件、类组件、DOM 元素等）
  type: Function | String,   // 对应的 ReactElement.type
  key: string | null,

  // 实例信息
  stateNode: any,            // 真实 DOM 节点或组件实例

  // Fiber 树结构
  return: Fiber | null,      // 父节点
  child: Fiber | null,       // 第一个子节点
  sibling: Fiber | null,     // 下一个兄弟节点

  // 状态和副作用
  pendingProps: any,         // 新的 props
  memoizedProps: any,        // 上次渲染的 props
  memoizedState: any,        // 上次渲染的 state
  updateQueue: mixed,        // 状态更新队列

  // 副作用
  flags: Flags,              // 标识需要执行的操作（插入、更新、删除等）
  subtreeFlags: Flags,       // 子树的副作用

  // 调度优先级
  lanes: Lanes,              // 当前 Fiber 的优先级
  childLanes: Lanes,         // 子树的优先级

  // 双缓存
  alternate: Fiber | null,   // 指向另一棵树中对应的节点
}
```

**关系**：
- ReactElement → 描述 UI（用户写的）
- Fiber → 工作单元（React 内部使用）
- ReactElement 通过协调过程转换为 Fiber 树

## 高频面试题

### Q1: JSX 是什么？为什么需要 JSX？

**答案**：

JSX 是 JavaScript 的语法扩展，允许我们在 JavaScript 中编写类似 HTML 的标记。

**为什么需要 JSX？**

1. **声明式 UI**：直观地描述 UI 应该是什么样子
2. **更好的可读性**：相比 `createElement` 嵌套调用更清晰
3. **类型安全**：可以进行静态分析和错误检查
4. **开发体验**：编辑器可以提供更好的代码提示和语法高亮

```javascript
// 使用 JSX - 清晰易读
<Button color="blue" onClick={handleClick}>
  Click me
</Button>

// 不使用 JSX - 难以阅读
React.createElement(
  Button,
  { color: 'blue', onClick: handleClick },
  'Click me'
)
```

### Q2: JSX 如何转换为真实 DOM？

**答案**：

完整的转换过程分为三个阶段：

1. **编译阶段**：Babel 将 JSX 编译为 `jsx()` 或 `createElement()` 调用
2. **协调阶段（Reconciliation）**：
   - 调用组件函数/类，生成 ReactElement 树（虚拟 DOM 树）
   - 通过 Diff 算法比较新旧虚拟 DOM，生成 Fiber 树
   - 标记需要更新的节点（Placement、Update、Deletion 等 flags）
3. **提交阶段（Commit）**：
   - 根据 Fiber 节点的 flags 执行真实 DOM 操作
   - 调用生命周期方法和副作用（useEffect 等）

```
JSX 代码
  ↓ [Babel 编译]
jsx() / createElement() 调用
  ↓ [执行]
ReactElement 树（虚拟 DOM）
  ↓ [协调 - Reconciliation]
Fiber 树 + 副作用标记
  ↓ [提交 - Commit]
真实 DOM
```

### Q3: 虚拟 DOM 的优势和劣势是什么？

**答案**：

**优势**：

1. **跨平台能力**：虚拟 DOM 是平台无关的，可以渲染到不同平台（Web、Native、Canvas）
2. **批量更新**：可以收集多个状态变更，一次性更新 DOM
3. **Diff 优化**：通过算法计算最小变更，减少 DOM 操作
4. **函数式编程**：声明式的 UI 描述，更容易理解和维护

**劣势**：

1. **内存占用**：需要维护额外的虚拟 DOM 树
2. **首次渲染慢**：需要创建虚拟 DOM 树，然后再创建真实 DOM
3. **不一定快**：对于简单场景，直接操作 DOM 可能更快
4. **学习成本**：需要理解虚拟 DOM 和 Diff 算法的概念

**关键点**：虚拟 DOM 的价值不是"快"，而是提供了一种声明式、可维护、跨平台的 UI 编程模型。

### Q4: React.createElement 做了什么？

**答案**：

`React.createElement`（或新的 `jsx()` 函数）主要做了以下事情：

```javascript
function createElement(type, config, children) {
  // 1. 提取并处理特殊属性
  let key = null;
  let ref = null;

  if (config != null) {
    if (hasValidKey(config)) {
      key = '' + config.key;  // 强制转换为字符串
    }
    if (hasValidRef(config)) {
      ref = config.ref;
    }
  }

  // 2. 构建 props 对象（排除 key 和 ref）
  const props = {};
  for (const propName in config) {
    if (shouldIncludeProp(propName)) {
      props[propName] = config[propName];
    }
  }

  // 3. 处理 children
  // children 可以是多个参数，全部放入 props.children
  const childrenLength = arguments.length - 2;
  if (childrenLength === 1) {
    props.children = children;
  } else if (childrenLength > 1) {
    props.children = Array.from(arguments).slice(2);
  }

  // 4. 处理组件的 defaultProps
  if (type && type.defaultProps) {
    const defaultProps = type.defaultProps;
    for (const propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }

  // 5. 创建并返回 ReactElement 对象
  return ReactElement(
    type,
    key,
    ref,
    props,
    ReactCurrentOwner.current  // 记录当前正在渲染的组件
  );
}
```

**核心工作**：
1. 提取 key 和 ref（它们不会传递给组件）
2. 构建 props 对象
3. 合并 children 到 props
4. 应用 defaultProps
5. 创建描述性对象（ReactElement）

**不做的事**：
- 不创建真实 DOM
- 不执行组件函数/类
- 不进行任何副作用操作

### Q5: 为什么 $$typeof 字段使用 Symbol？

**答案**：

这是一个**安全机制**，用于防止 XSS 攻击。

```javascript
// 安全的 React Element
const element = {
  $$typeof: Symbol.for('react.element'),  // Symbol 值
  type: 'div',
  props: { children: 'Safe content' }
};

// 潜在的 XSS 攻击
const maliciousElement = {
  $$typeof: 'react.element',  // 字符串！
  type: 'script',
  props: {
    dangerouslySetInnerHTML: {
      __html: 'alert("XSS")'
    }
  }
};
```

**为什么 Symbol 安全？**

1. **无法序列化**：`JSON.stringify` 会忽略 Symbol，攻击者无法通过 API 注入假的 React Element
2. **全局唯一**：`Symbol.for('react.element')` 在整个应用中只有一个实例
3. **运行时检查**：React 会检查 `$$typeof` 是否是正确的 Symbol，不匹配就拒绝渲染

```javascript
// React 渲染前的检查
function isValidElement(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE  // 必须是 Symbol
  );
}
```

## 实战案例

### 案例 1：自定义 JSX 转换

理解 JSX 转换后，我们可以手动创建 React 元素：

```javascript
import { jsx } from 'react/jsx-runtime';

// JSX 写法
const element1 = <div className="box">Hello</div>;

// 等价的手动创建
const element2 = jsx('div', {
  className: 'box',
  children: 'Hello'
});

// 完全相同
console.log(element1.type === element2.type);        // true
console.log(element1.props === element2.props);      // false（不同对象）
console.log(element1.props.className === element2.props.className);  // true
```

### 案例 2：动态创建组件

```javascript
// 根据类型动态创建组件
function DynamicComponent({ type, ...props }) {
  // type 可以是字符串或组件
  return jsx(type, props);
}

// 使用
<DynamicComponent type="button" onClick={handleClick}>
  Click me
</DynamicComponent>

<DynamicComponent type={CustomButton} color="blue">
  Custom Button
</DynamicComponent>
```

### 案例 3：理解 children 的处理

```javascript
// 单个子元素
<div>Hello</div>
// props.children = "Hello"（字符串）

// 多个子元素
<div>
  <span>Hello</span>
  <span>World</span>
</div>
// props.children = [ReactElement, ReactElement]（数组）

// 没有子元素
<div />
// props.children = undefined
```

## 总结

1. **JSX 是语法糖**，会被编译为函数调用（`jsx()` 或 `createElement()`）
2. **ReactElement 是轻量的描述对象**，描述 UI 应该是什么样子
3. **Fiber 是工作单元**，React 用它来调度和协调更新
4. **虚拟 DOM 的价值**在于提供声明式、可维护、跨平台的编程模型
5. **$$typeof Symbol** 用于安全地标识 React 元素，防止 XSS 攻击

## 相关源码文件

- `packages/react/src/jsx/ReactJSXElement.js` - JSX 转换和 ReactElement 创建
- `packages/react/src/ReactClient.js` - React 客户端 API
- `packages/shared/ReactSymbols.js` - React 内部使用的 Symbol 定义
- `packages/react-reconciler/src/ReactFiber.js` - Fiber 节点创建

---

**下一篇**: [02 - Fiber 架构和调度原理](./02-Fiber架构与调度原理.md)
