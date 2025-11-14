/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 【面试重点】Fiber 节点类型定义
// WorkTag 用于标识 Fiber 节点的类型，React 根据不同的 tag 执行不同的处理逻辑
// 这是面试中经常问到的：React 如何区分不同类型的组件？答案就在这里

export type WorkTag =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31;

// 【面试高频】函数组件 - 最常用，如 function App() {}
export const FunctionComponent = 0;

// 【面试高频】类组件 - 如 class App extends React.Component {}
export const ClassComponent = 1;

// 未确定类型的组件 - 初次渲染时还不知道是函数还是类组件
export const IndeterminateComponent = 2; // Before we know whether it is function or class

// 根节点 - ReactDOM.render 或 createRoot 创建的根 Fiber
export const HostRoot = 3; // Root of a host tree. Could be nested inside another node.

// Portal 节点 - ReactDOM.createPortal 创建
export const HostPortal = 4; // A subtree. Could be an entry point to a different renderer.

// 【面试高频】原生 DOM 节点 - 如 <div>、<span> 等
export const HostComponent = 5;

// 文本节点 - 纯文本内容
export const HostText = 6;

// Fragment - <></> 或 <React.Fragment>
export const Fragment = 7;

// Mode 节点 - 如 StrictMode、ConcurrentMode
export const Mode = 8;

// Context Consumer - <Context.Consumer>
export const ContextConsumer = 9;

// Context Provider - <Context.Provider>
export const ContextProvider = 10;

// ForwardRef - React.forwardRef() 创建的组件
export const ForwardRef = 11;

// Profiler - <Profiler> 性能分析组件
export const Profiler = 12;

// 【面试考点】Suspense 组件 - <Suspense> 用于代码分割
export const SuspenseComponent = 13;

// 【面试考点】Memo 组件 - React.memo() 包裹的组件
export const MemoComponent = 14;

// 简化的 Memo 组件 - 优化后的 memo
export const SimpleMemoComponent = 15;

// Lazy 组件 - React.lazy() 懒加载组件
export const LazyComponent = 16;

// 未完成的类组件 - 渲染过程中抛出错误的类组件
export const IncompleteClassComponent = 17;

// 脱水的 Fragment - SSR 相关
export const DehydratedFragment = 18;

// SuspenseList 组件 - 实验性功能
export const SuspenseListComponent = 19;
export const ScopeComponent = 21;
export const OffscreenComponent = 22;
export const LegacyHiddenComponent = 23;
export const CacheComponent = 24;
export const TracingMarkerComponent = 25;
export const HostHoistable = 26;
export const HostSingleton = 27;
export const IncompleteFunctionComponent = 28;
export const Throw = 29;
export const ViewTransitionComponent = 30;
export const ActivityComponent = 31;
