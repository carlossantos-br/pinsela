import React from "react";

export type PageRefreshApi = {
  refreshNow?: () => Promise<any>;
  isFetching?: boolean;
  hasPending?: boolean;
  applyPending?: () => void;
  discardPending?: () => void;
};

type CtxValue = {
  api: PageRefreshApi;
  setApi: (api: PageRefreshApi) => void;
};

const Ctx = React.createContext<CtxValue | null>(null);

export function PageRefreshProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = React.useState<PageRefreshApi>({});
  const value = React.useMemo(() => ({ api, setApi }), [api]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageRefresh(): CtxValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("usePageRefresh must be used within PageRefreshProvider");
  return v;
}

export function useRegisterPageRefresh(api: PageRefreshApi, deps: React.DependencyList) {
  const { setApi } = usePageRefresh();
  React.useEffect(() => {
    setApi(api);
    return () => setApi({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

