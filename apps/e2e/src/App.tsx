import {
	createRouter,
	createRootRoute,
	createRoute,
	RouterProvider,
	Outlet,
} from "@tanstack/solid-router";
import BasicPage from "./routes/basic";
import FormulasPage from "./routes/formulas";
import ClipboardPage from "./routes/clipboard";
import AutofillPage from "./routes/autofill";
import HistoryPage from "./routes/history";
import ReadonlyPage from "./routes/readonly";
import LargePage from "./routes/large";

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => (
		<nav style={{ padding: "2rem", "font-family": "sans-serif" }}>
			<h1>E2E Test Routes</h1>
			<ul>
				<li><a href="/basic">Basic</a></li>
				<li><a href="/formulas">Formulas</a></li>
				<li><a href="/clipboard">Clipboard</a></li>
				<li><a href="/autofill">Autofill</a></li>
				<li><a href="/history">History</a></li>
				<li><a href="/readonly">Readonly</a></li>
				<li><a href="/large">Large Dataset</a></li>
			</ul>
		</nav>
	),
});

const basicRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/basic",
	component: BasicPage,
});

const formulasRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/formulas",
	component: FormulasPage,
});

const clipboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/clipboard",
	component: ClipboardPage,
});

const autofillRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/autofill",
	component: AutofillPage,
});

const historyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/history",
	component: HistoryPage,
});

const readonlyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/readonly",
	component: ReadonlyPage,
});

const largeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/large",
	component: LargePage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	basicRoute,
	formulasRoute,
	clipboardRoute,
	autofillRoute,
	historyRoute,
	readonlyRoute,
	largeRoute,
]);

const router = createRouter({ routeTree });

export default function App() {
	return <RouterProvider router={router} />;
}
