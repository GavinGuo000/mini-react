// ============================================================================
// mini-react 对外入口
// ----------------------------------------------------------------------------
// 既提供默认导出 MiniReact（给 JSX 的 jsxFactory 使用），
// 也提供按需导入的具名导出（createRoot、useState 等）。
// ============================================================================

import { createElement, Fragment } from "./createElement.js";
import { render } from "./reconciler.js";
import {
  useState,
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "./hooks.js";

// 仿 React 18 的 createRoot API：MiniReactDOM.createRoot(container).render(<App/>)
function createRoot(container) {
  return {
    render(element) {
      render(element, container);
    },
  };
}

const MiniReact = {
  createElement,
  Fragment,
  createRoot,
  useState,
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
};

export {
  createElement,
  Fragment,
  createRoot,
  render,
  useState,
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
};

export default MiniReact;
