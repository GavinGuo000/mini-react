import { createRoot } from "/src/mini-react/index.js";
import App from "./App.jsx";
import "./styles.css";

// 仿 React 18：createRoot(container).render(<App />)
const root = createRoot(document.getElementById("root"));
root.render(<App />);
