/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 【面试重点】副作用标记（Effect Flags）
// React 使用二进制位标记来高效地标识 Fiber 节点需要执行的操作
// 面试常问：React 如何知道哪些节点需要更新？答案：通过 flags 标记
//
// 为什么用二进制？
// 1. 节省内存：一个数字可以表示多个标记（位运算）
// 2. 高效判断：通过 & 运算快速检查是否有某个标记
// 3. 组合灵活：通过 | 运算可以组合多个标记

export type Flags = number;

// Don't change these two values. They're used by React Dev Tools.
// 无副作用 - 节点不需要任何操作
export const NoFlags = /*                      */ 0b000000000000000000;

// 已执行工作 - 标记节点已经被处理过（用于 React DevTools）
export const PerformedWork = /*                */ 0b000000000000000001;

// You can change the rest (and add more).
// 【面试高频】插入操作 - 标记节点需要插入到 DOM（新增节点）
export const Placement = /*                    */ 0b000000000000000010;

// 【面试高频】更新操作 - 标记节点属性需要更新
export const Update = /*                       */ 0b000000000000000100;

// 插入且更新 - 组合标记（Placement | Update）
export const PlacementAndUpdate = /*           */ 0b000000000000000110;

// 【面试高频】删除操作 - 标记节点需要从 DOM 中删除
export const Deletion = /*                     */ 0b000000000000001000;

// 内容重置 - 标记文本内容需要重置
export const ContentReset = /*                 */ 0b000000000000010000;

// 回调 - 标记有回调函数需要执行（如 setState 的回调）
export const Callback = /*                     */ 0b000000000000100000;

// 已捕获 - 标记组件捕获了错误（Error Boundary 相关）
export const DidCapture = /*                   */ 0b000000000001000000;

// Ref - 标记需要更新 ref 引用
export const Ref = /*                          */ 0b000000000010000000;

// Snapshot - 标记需要获取快照（getSnapshotBeforeUpdate）
export const Snapshot = /*                     */ 0b000000000100000000;

// 【面试考点】Passive - 标记有 useEffect 需要执行（被动副作用）
export const Passive = /*                      */ 0b000000001000000000;
// TODO (effects) Remove this bit once the new reconciler is synced to the old.
// Passive 卸载待处理（开发模式） - 用于开发环境的调试
export const PassiveUnmountPendingDev = /*     */ 0b000010000000000000;

// Hydrating - 标记正在进行 hydration（SSR 相关）
export const Hydrating = /*                    */ 0b000000010000000000;

// Hydrating 且 Update - 组合标记
export const HydratingAndUpdate = /*           */ 0b000000010000000100;

// 生命周期副作用掩码 - Passive & Update & Callback & Ref & Snapshot 的组合
// 用于快速判断是否有生命周期相关的副作用需要执行
export const LifecycleEffectMask = /*          */ 0b000000001110100100;

// 宿主副作用掩码 - 所有宿主相关副作用的并集
// 用于判断是否需要操作真实 DOM
export const HostEffectMask = /*               */ 0b000000011111111111;

// These are not really side effects, but we still reuse this field.
// 未完成 - 标记渲染未完成（通常因为 Suspense 或错误）
export const Incomplete = /*                   */ 0b000000100000000000;

// 应该捕获 - 标记应该捕获错误
export const ShouldCapture = /*                */ 0b000001000000000000;

// 强制更新（旧版 Suspense） - 兼容旧版 Suspense 的强制更新
export const ForceUpdateForLegacySuspense = /* */ 0b000100000000000000;

// Static tags describe aspects of a fiber that are not specific to a render,
// e.g. a fiber uses a passive effect (even if there are no updates on this particular render).
// This enables us to defer more work in the unmount case,
// since we can defer traversing the tree during layout to look for Passive effects,
// and instead rely on the static flag as a signal that there may be cleanup work.
// Passive 静态标记 - 标记 Fiber 包含 passive effect（不论是否本次渲染）
// 用于优化卸载时的性能，避免遍历整棵树查找 Passive effects
export const PassiveStatic = /*                */ 0b001000000000000000;

// 【面试重点】副作用分组掩码 - 用于 commit 阶段的三个子阶段
// Union of side effect groupings as pertains to subtreeFlags

// Before Mutation 掩码 - before mutation 阶段需要处理的副作用
export const BeforeMutationMask = /*           */ 0b000000001100001010;

// Mutation 掩码 - mutation 阶段需要处理的副作用（真实 DOM 操作）
export const MutationMask = /*                 */ 0b000000010010011110;

// Layout 掩码 - layout 阶段需要处理的副作用（useLayoutEffect）
export const LayoutMask = /*                   */ 0b000000000010100100;

// Passive 掩码 - 用于判断是否有 useEffect 需要执行
export const PassiveMask = /*                  */ 0b000000001000001000;

// Union of tags that don't get reset on clones.
// This allows certain concepts to persist without recalculting them,
// e.g. whether a subtree contains passive effects or portals.
// 静态掩码 - 克隆时不重置的标记
// 用于保持某些状态，避免重复计算（如子树是否包含 passive effects）
export const StaticMask = /*                   */ 0b001000000000000000;

// These flags allow us to traverse to fibers that have effects on mount
// without traversing the entire tree after every commit for
// double invoking
// Mount Layout 开发模式 - 标记挂载时的 layout effects（用于开发环境的双重调用）
export const MountLayoutDev = /*               */ 0b010000000000000000;

// Mount Passive 开发模式 - 标记挂载时的 passive effects（用于开发环境的双重调用）
export const MountPassiveDev = /*              */ 0b100000000000000000;
