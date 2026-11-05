import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowRight, Filter, Globe2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api, useResource } from "./api";
import { useAuth } from "./session";
import {
  CUSTOMER_TYPES,
  LEGAL_TYPES,
  hasPermission,
  requiresLegalName,
  type Customer,
  type Reference,
} from "./types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Section,
  StatusBadge,
} from "./ui";

export function Customers() {
  const { user } = useAuth();
  const reference = useResource<Reference>("/reference");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = new URLSearchParams({ page: String(page) });
  if (q) query.set("q", q);
  if (type) query.set("type", type);
  if (country) query.set("country", country);
  if (region) query.set("region", region);
  if (status) query.set("status", status);
  const { data, loading, error, reload } = useResource<{
    items: Customer[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/customers?${query}`);
  const filtered = !!(q || type || country || region || status);
  function change(set: (v: string) => void, value: string) {
    set(value);
    setPage(1);
  }
  function clear() {
    setSearch("");
    setQ("");
    setType("");
    setCountry("");
    setRegion("");
    setStatus("");
    setPage(1);
  }
  return (
    <>
      <PageHeader
        eyebrow="RELATIONSHIP MANAGEMENT"
        title="Customers"
        description="Your customers, their people, and the information that keeps you connected."
        action={
          hasPermission(user, "customers.create") ? (
            <LinkButton href="/customers/new">
              <Plus size={17} />
              New customer
            </LinkButton>
          ) : undefined
        }
      />
      <section className="panel customer-directory">
        <div className="directory-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search customers"
              placeholder="Search by name, email, or tax ID…"
              maxLength={160}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="Clear search" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </div>
          <span className="directory-count">
            {data
              ? `${data.total} ${data.total === 1 ? "customer" : "customers"}`
              : "Customer directory"}
          </span>
        </div>
        <div className="filter-row">
          <span className="filter-label">
            <Filter size={15} />
            Filter by
          </span>
          <select
            aria-label="Filter by customer type"
            value={type}
            onChange={e => change(setType, e.target.value)}
          >
            <option value="">All customer types</option>
            {CUSTOMER_TYPES.map(t => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter by country"
            value={country}
            onChange={e => change(setCountry, e.target.value)}
            disabled={reference.loading}
          >
            <option value="">All countries</option>
            {reference.data?.countries.map(c => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by region"
            value={region}
            onChange={e => change(setRegion, e.target.value)}
            disabled={reference.loading}
          >
            <option value="">All regions</option>
            {reference.data?.regions.map(r => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by customer status"
            value={status}
            onChange={e => change(setStatus, e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          {filtered && (
            <button className="clear-filters" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
        {reference.error && (
          <div className="table-notice">
            <Notice tone="warning">
              Country and region filters are unavailable.{" "}
              <button className="inline-link" onClick={reference.reload}>
                Retry loading reference data
              </button>
            </Notice>
          </div>
        )}
        {loading ? (
          <Loading label="Loading customers…" />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={
              filtered
                ? "No customers match these filters."
                : "Your customer directory starts here."
            }
            description={
              filtered
                ? "Try a different search or clear the filters to see more relationships."
                : "Create your first customer record. Add their business details now and the people behind the relationship whenever you’re ready."
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              ) : hasPermission(user, "customers.create") ? (
                <LinkButton href="/customers/new">
                  <Plus size={16} />
                  Add your first customer
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          data && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>Country / region</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th>
                        <span className="sr-only">View</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map(customer => (
                      <tr key={customer.id}>
                        <td>
                          <Link
                            className="customer-cell"
                            href={`/customers/${customer.id}`}
                          >
                            <span className="company-avatar">
                              {customer.displayName.slice(0, 1).toUpperCase()}
                            </span>
                            <span>
                              <strong>{customer.displayName}</strong>
                              <small>
                                {customer.email ||
                                  customer.legalName ||
                                  "No email provided"}
                              </small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="table-type">
                            {customer.customerType}
                          </span>
                        </td>
                        <td>
                          <div className="country-cell">
                            <strong>
                              {reference.data?.countries.find(
                                c => c.code === customer.countryCode
                              )?.name ?? customer.countryCode}
                            </strong>
                            <small>
                              {reference.data?.regions.find(
                                r => r.code === customer.regionCode
                              )?.name ?? customer.regionCode}
                            </small>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={customer.status} />
                        </td>
                        <td className="date-cell">
                          {formatDate(customer.updatedAt)}
                        </td>
                        <td>
                          <Link
                            className="row-action"
                            aria-label={`View ${customer.displayName}`}
                            href={`/customers/${customer.id}`}
                          >
                            <ArrowRight size={17} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={setPage}
              />
            </>
          )
        )}
      </section>
      <div className="page-footnote">
        <Globe2 size={14} />
        Customer accounts are business records, not user accounts. There is no
        customer login portal in V1.
      </div>
    </>
  );
}

const blankCustomer = {
  displayName: "",
  legalName: "",
  customerType: "",
  legalEntityType: "",
  countryCode: "",
  email: "",
  phone: "",
  website: "",
  taxId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};
type CustomerFormValue = typeof blankCustomer;
export function CustomerEditor({ id }: { id?: string }) {
  const reference = useResource<Reference>("/reference");
  const record = useResource<{ customer: Customer }>(
    id ? `/customers/${id}` : null
  );
  const [value, setValue] = useState<CustomerFormValue>({ ...blankCustomer });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState<Customer | null>(null);
  useEffect(() => {
    if (record.data) {
      const next = { ...blankCustomer };
      for (const key of Object.keys(next) as (keyof CustomerFormValue)[])
        next[key] = record.data.customer[key] ?? "";
      setValue(next);
    }
  }, [record.data]);
  function set(key: keyof CustomerFormValue, v: string) {
    setValue(old => ({ ...old, [key]: v }));
    setSaved(null);
    setWarnings([]);
  }
  const selectedCountry = reference.data?.countries.find(
    c => c.code === value.countryCode
  );
  const derivedRegion = reference.data?.regions.find(
    r => r.code === selectedCountry?.regionCode
  )?.name;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await api<{ customer: Customer; warnings: string[] }>(
        id ? `/customers/${id}` : "/customers",
        {
          method: id ? "PUT" : "POST",
          body: {
            ...value,
            displayName: value.displayName.trim(),
            legalEntityType: value.legalEntityType || null,
          },
        }
      );
      setSaved(result.customer);
      setWarnings(result.warnings ?? []);
      toast.success(id ? "Customer updated." : "Customer created.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (reference.loading || (id && record.loading))
    return <Loading label="Loading customer form…" />;
  if (reference.error || record.error)
    return (
      <ErrorState
        error={reference.error || record.error!}
        retry={() => {
          reference.reload();
          record.reload();
        }}
      />
    );
  if (id && record.data?.customer.status === "ARCHIVED")
    return (
      <>
        <PageHeader
          title="This customer is archived"
          back={{ href: `/customers/${id}`, label: "Back to customer" }}
        />
        <Notice tone="warning">
          Restore this customer before editing its information. If you do not
          have archive permissions, ask an administrator to restore it.
        </Notice>
        <LinkButton href={`/customers/${id}`} secondary>
          View customer record
        </LinkButton>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER DIRECTORY"
        title={id ? "Edit customer" : "New customer"}
        description="Build a clear account record. Required fields are marked with an asterisk."
        back={{
          href: id ? `/customers/${id}` : "/customers",
          label: id ? "Back to customer" : "Back to customers",
        }}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {saved && (
        <Notice
          tone="success"
          title={id ? "Customer updated" : "Customer created"}
        >
          Your changes are saved.{" "}
          <Link className="inline-link" href={`/customers/${saved.id}`}>
            View customer record <ArrowRight size={14} />
          </Link>
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warning" title="Possible duplicates found">
          The record was saved. Review these similarities before creating
          additional records.
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}
      <form onSubmit={submit} className="record-form">
        <fieldset disabled={busy || (!!saved && !id)}>
          <Section
            title="Customer identity"
            description="Customer type and legal entity are separate dimensions."
          >
            <div className="form-grid">
              <Field label="Customer name" required>
                <input
                  required
                  maxLength={200}
                  value={value.displayName}
                  onChange={e => set("displayName", e.target.value)}
                  placeholder="Name used in your customer directory"
                />
              </Field>
              <Field label="Customer type" required>
                <select
                  required
                  value={value.customerType}
                  onChange={e => set("customerType", e.target.value)}
                >
                  <option value="">Select a customer type</option>
                  {CUSTOMER_TYPES.map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Legal entity type"
                hint="Optional. Independent of the customer’s business type."
              >
                <select
                  value={value.legalEntityType}
                  onChange={e => set("legalEntityType", e.target.value)}
                >
                  <option value="">Not specified</option>
                  {LEGAL_TYPES.map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Legal name"
                required={requiresLegalName(value.legalEntityType)}
                hint={
                  requiresLegalName(value.legalEntityType)
                    ? "Required for this registered legal entity."
                    : "Registered name, when applicable."
                }
              >
                <input
                  required={requiresLegalName(value.legalEntityType)}
                  maxLength={240}
                  value={value.legalName}
                  onChange={e => set("legalName", e.target.value)}
                  placeholder="Registered legal name"
                />
              </Field>
              <Field label="Country" required>
                <select
                  required
                  value={value.countryCode}
                  onChange={e => set("countryCode", e.target.value)}
                >
                  <option value="">Select a country</option>
                  {reference.data?.countries.map(c => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Business region"
                hint="Derived from the configured country mapping. No pricing rules apply."
              >
                <input
                  value={
                    derivedRegion ||
                    (value.countryCode
                      ? (selectedCountry?.regionCode ?? "Mapping unavailable")
                      : "Select a country first")
                  }
                  disabled
                />
              </Field>
              <Field label="Tax ID">
                <input
                  maxLength={100}
                  value={value.taxId}
                  onChange={e => set("taxId", e.target.value)}
                  placeholder="Optional tax or registration ID"
                />
              </Field>
            </div>
          </Section>
          <Section
            title="Communication"
            description="Use the customer’s general contact details. Individual contacts can be added after saving."
          >
            <div className="form-grid">
              <Field label="General email">
                <input
                  type="email"
                  maxLength={254}
                  value={value.email}
                  onChange={e => set("email", e.target.value)}
                  placeholder="contact@customer.com"
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  maxLength={60}
                  value={value.phone}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="Include the country calling code"
                />
              </Field>
              <Field label="Website">
                <input
                  type="url"
                  maxLength={2048}
                  value={value.website}
                  onChange={e => set("website", e.target.value)}
                  placeholder="https://"
                />
              </Field>
            </div>
          </Section>
          <Section
            title="Address"
            description="Optional location details for the customer record."
          >
            <div className="form-grid">
              <Field label="Address line 1" wide>
                <input
                  maxLength={240}
                  value={value.addressLine1}
                  onChange={e => set("addressLine1", e.target.value)}
                  autoComplete="address-line1"
                />
              </Field>
              <Field label="Address line 2" wide>
                <input
                  maxLength={240}
                  value={value.addressLine2}
                  onChange={e => set("addressLine2", e.target.value)}
                  autoComplete="address-line2"
                />
              </Field>
              <Field label="City">
                <input
                  maxLength={120}
                  value={value.city}
                  onChange={e => set("city", e.target.value)}
                />
              </Field>
              <Field label="State / province">
                <input
                  maxLength={120}
                  value={value.state}
                  onChange={e => set("state", e.target.value)}
                />
              </Field>
              <Field label="Postal code">
                <input
                  maxLength={32}
                  value={value.postalCode}
                  onChange={e => set("postalCode", e.target.value)}
                />
              </Field>
            </div>
          </Section>
          <Section
            title="Relationship notes"
            description="Keep useful account context here. Do not enter passwords, tokens, or sensitive patient information."
          >
            <div className="form-grid">
              <Field label="Notes" wide>
                <textarea
                  rows={5}
                  maxLength={10000}
                  value={value.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Relevant details for your team…"
                />
                <span className="character-count">
                  {value.notes.length.toLocaleString()} / 10,000
                </span>
              </Field>
            </div>
          </Section>
        </fieldset>
        <div className="form-actions">
          <Link
            className="btn btn-secondary"
            href={id ? `/customers/${id}` : "/customers"}
          >
            {saved ? "View directory" : "Cancel"}
          </Link>
          <span className="form-actions-note">
            {saved
              ? "All changes saved"
              : "Your changes are saved only when you submit."}
          </span>
          <Button type="submit" busy={busy} disabled={!!saved}>
            {id ? "Save changes" : "Create customer"}
          </Button>
        </div>
      </form>
    </>
  );
}
