import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isNoDataset } from "../api/client";
import { useDashboard } from "../api/hooks";
import { Empty, ErrorNotice, Loading } from "./ui";
import type { Dashboard } from "../api/types";
export function OperationalGate({
  children,
}: {
  children: (data: Dashboard) => ReactNode;
}) {
  const query = useDashboard();
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <>
        <ErrorNotice
          error={isNoDataset(query.error) ? null : query.error}
          retry={() => void query.refetch()}
        />
        <Empty
          title="Start with a dataset"
          action={
            <Link className="button primary" to="/simulation">
              Open Simulation Lab
            </Link>
          }
        >
          Validate and import a synthetic dataset to start the operations
          workspace.
        </Empty>
      </>
    );
  if (!query.data.dataset_id)
    return (
      <Empty
        title="Your workspace is ready"
        action={
          <Link className="button primary" to="/simulation">
            Import synthetic dataset
          </Link>
        }
      >
        Choose one of the supplied examples or upload a same-format dataset in
        Simulation Lab.
      </Empty>
    );
  return <>{children(query.data)}</>;
}
