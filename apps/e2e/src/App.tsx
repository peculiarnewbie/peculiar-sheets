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
import RowsPage from "./routes/rows";
import SortExternalPage from "./routes/sort-external";
import SortViewPage from "./routes/sort-view";
import SortMutationPage from "./routes/sort-mutation";
import SortMutationFormulasPage from "./routes/sort-mutation-formulas";
import FormulaRowsPage from "./routes/formula-rows";
import FormulaRowDeletePage from "./routes/formula-row-delete";

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
				<li><a href="/sort-external">Sort External</a></li>
				<li><a href="/sort-view">Sort View</a></li>
				<li><a href="/sort-mutation">Sort Mutation</a></li>
				<li><a href="/sort-mutation-formulas">Sort Mutation Formulas</a></li>
				<li><a href="/formula-rows">Formula + Row Ops</a></li>
				<li><a href="/formula-row-delete">Formula + Row Delete</a></li>
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

const rowsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/rows",
	component: RowsPage,
});

const sortExternalRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sort-external",
	component: SortExternalPage,
});

const sortViewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sort-view",
	component: SortViewPage,
});

const sortMutationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sort-mutation",
	component: SortMutationPage,
});

const sortMutationFormulasRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sort-mutation-formulas",
	component: SortMutationFormulasPage,
});

const formulaRowsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/formula-rows",
	component: FormulaRowsPage,
});

const formulaRowDeleteRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/formula-row-delete",
	component: FormulaRowDeletePage,
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
	rowsRoute,
	sortExternalRoute,
	sortViewRoute,
	sortMutationRoute,
	sortMutationFormulasRoute,
	formulaRowsRoute,
	formulaRowDeleteRoute,
]);

const router = createRouter({ routeTree });

export default function App() {
	return <RouterProvider router={router} />;
}
