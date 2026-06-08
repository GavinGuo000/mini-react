import { defineConfig } from "vite";

// 关键：把 JSX 编译目标指向我们自己实现的 MiniReact.createElement / Fragment，
// 这样 <div /> 这种语法会被 esbuild 转成 MiniReact.createElement("div", ...)。
// jsxInject 会在每个 .jsx 文件顶部自动注入 MiniReact 的引入，免去手动 import。
export default defineConfig({
  esbuild: {
    jsxFactory: "MiniReact.createElement",
    jsxFragment: "MiniReact.Fragment",
    jsxInject: `import MiniReact from "/src/mini-react/index.js"`,
  },
});
