import { useState } from "react";
import { Activity, Eye, ShieldCheck } from "lucide-react";
import { useResource } from "./api";
import { type AuditEntry } from "./types";
import { readableAction } from "./dashboard";
import {
  Badge,
  Button,
  DataValue,
  EmptyState,
  ErrorState,
  formatDate,
  Loading,
  Modal,
  PageHeader,
  Pagination,
} from "./ui";

type AuditData = {
  items: AuditEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages?: number;
  };
};
export function AuditTrail() {
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const resource = useResource<AuditData>(`/audit?page=${page}`);
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE GOVERNANCE"
        title="Audit trail"
        description="A read-only record of administrative and customer changes. Accountability without exposing secrets."
      />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recorded changes</h2>
            <p>Showing persisted activity, most recent first.</p>
          </div>
          <Badge>
            <ShieldCheck size={12} />
            Read only
          </Badge>
        </div>
        {resource.loading ? (
          <Loading label="Loading audit history…" />
        ) : resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : resource.data && resource.data.items.length === 0 ? (
          <EmptyState
            title="No recorded changes yet."
            description="Access decisions, role assignments, company changes and customer updates will appear here as they happen."
          />
        ) : (
          resource.data && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Record</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.items.map(item => (
                      <tr key={item.id}>
                        <td className="date-cell">
                          {formatDate(item.createdAt, true)}
                        </td>
                        <td>
                          <div className="audit-action">
                            <Activity size={16} />
                            <strong>{readableAction(item.action)}</strong>
                          </div>
                        </td>
                        <td>
                          <div className="country-cell">
                            <strong>
                              {item.actorName ||
                                item.actorEmail ||
                                (item.actorId ? "Workspace account" : "System")}
                            </strong>
                            <small>
                              {item.actorEmail ||
                                item.actorId ||
                                "Automated system event"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="country-cell">
                            <strong>{item.entityType || "—"}</strong>
                            <small className="mono audit-record-id">
                              {item.entityId || "—"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            aria-label={`View details for ${readableAction(item.action)}`}
                            onClick={() => setDetail(item)}
                          >
                            <Eye size={15} />
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={resource.data.pagination.page}
                pageSize={resource.data.pagination.pageSize}
                total={resource.data.pagination.total}
                onPage={setPage}
              />
            </>
          )
        )}
      </section>
      <div className="page-footnote">
        <ShieldCheck size={15} />
        Audit data is immutable in this interface. Passwords and authentication
        tokens are never displayed.
      </div>
      {detail && (
        <Modal title="Audit event details" onClose={() => setDetail(null)}>
          <dl className="detail-grid audit-detail-grid">
            <DataValue label="Action">
              {readableAction(detail.action)}
            </DataValue>
            <DataValue label="Recorded">
              {formatDate(detail.createdAt, true)}
            </DataValue>
            <DataValue label="Actor">
              {detail.actorName ||
                detail.actorEmail ||
                detail.actorId ||
                "System"}
            </DataValue>
            <DataValue label="Record type">{detail.entityType}</DataValue>
            <DataValue label="Record ID">
              <span className="mono">{detail.entityId}</span>
            </DataValue>
            <DataValue label="Event ID">
              <span className="mono">{detail.id}</span>
            </DataValue>
          </dl>
          <div className="audit-metadata">
            <h3>Change metadata</h3>
            {detail.metadata && Object.keys(detail.metadata).length ? (
              <pre>{JSON.stringify(detail.metadata, null, 2)}</pre>
            ) : (
              <p className="muted">No additional metadata was recorded.</p>
            )}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
