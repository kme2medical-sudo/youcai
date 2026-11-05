import { useEffect, useState, type FormEvent } from "react";
import { Building2, Globe2, Save } from "lucide-react";
import { toast } from "sonner";
import { api, useResource } from "./api";
import { useAuth } from "./session";
import { hasPermission, type Company, type Reference } from "./types";
import {
  Button,
  Field,
  formatDate,
  Loading,
  ErrorState,
  Notice,
  PageHeader,
  Section,
} from "./ui";

const blank = {
  tradingName: "",
  legalName: "",
  logoUrl: "",
  website: "",
  email: "",
  phone: "",
  countryCode: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  timezone: "UTC",
  defaultCurrency: "USD",
  description: "",
};
type CompanyForm = typeof blank;
const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
export function CompanySettings() {
  const { user } = useAuth();
  const company = useResource<Company>("/company");
  const reference = useResource<Reference>("/reference");
  const [value, setValue] = useState<CompanyForm>({ ...blank });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const canEdit = hasPermission(user, "company.update");
  useEffect(() => {
    if (company.data) {
      const next = { ...blank };
      for (const key of Object.keys(next) as (keyof CompanyForm)[])
        next[key] = company.data[key] ?? "";
      setValue(next);
      setDirty(false);
    }
  }, [company.data]);
  function set(key: keyof CompanyForm, v: string) {
    setValue(old => ({ ...old, [key]: v }));
    setDirty(true);
    setSaved(false);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<Company>("/company", {
        method: "PUT",
        body: {
          ...value,
          defaultCurrency: value.defaultCurrency.toUpperCase(),
        },
      });
      toast.success("Company information saved.");
      setSaved(true);
      company.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (company.loading || reference.loading)
    return <Loading label="Loading company information…" />;
  if (company.error || reference.error)
    return (
      <ErrorState
        error={company.error || reference.error!}
        retry={() => {
          company.reload();
          reference.reload();
        }}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="GENERAL SETTINGS"
        title="Youcai information"
        description="Maintain the single company record used across your workspace."
      />
      <Notice title="Your company information, entered by your team">
        This record starts with blank business details and neutral
        timezone/currency defaults. Nothing here is a verified legal claim.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && (
        <Notice tone="success">Company information has been saved.</Notice>
      )}
      <form className="record-form" onSubmit={submit}>
        <fieldset disabled={!canEdit || busy}>
          <Section
            title="Company identity"
            description="Trading name and registered legal identity."
          >
            <div className="form-grid">
              <Field label="Trading name">
                <input
                  maxLength={240}
                  value={value.tradingName}
                  onChange={e => set("tradingName", e.target.value)}
                  placeholder="Enter company trading name"
                />
              </Field>
              <Field label="Legal name">
                <input
                  maxLength={240}
                  value={value.legalName}
                  onChange={e => set("legalName", e.target.value)}
                  placeholder="Enter registered legal name"
                />
              </Field>
              <Field
                label="Logo URL"
                wide
                hint="Optional public HTTP(S) image URL. No file uploads in Foundation V1."
              >
                <input
                  type="url"
                  maxLength={2048}
                  value={value.logoUrl}
                  onChange={e => set("logoUrl", e.target.value)}
                  placeholder="https://…"
                />
              </Field>
            </div>
          </Section>
          <Section
            title="General contact details"
            description="Company-wide communication channels."
          >
            <div className="form-grid">
              <Field label="Website">
                <input
                  type="url"
                  maxLength={2048}
                  value={value.website}
                  onChange={e => set("website", e.target.value)}
                  placeholder="https://"
                />
              </Field>
              <Field label="General email">
                <input
                  type="email"
                  maxLength={254}
                  value={value.email}
                  onChange={e => set("email", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  maxLength={60}
                  value={value.phone}
                  onChange={e => set("phone", e.target.value)}
                />
              </Field>
            </div>
          </Section>
          <Section title="Registered address">
            <div className="form-grid">
              <Field label="Registered country">
                <select
                  value={value.countryCode}
                  onChange={e => set("countryCode", e.target.value)}
                >
                  <option value="">Not specified</option>
                  {reference.data?.countries.map(c => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Street address" wide>
                <input
                  maxLength={240}
                  value={value.addressLine1}
                  onChange={e => set("addressLine1", e.target.value)}
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
            title="Workspace defaults"
            description="Timezone and currency are reference defaults, not pricing rules."
          >
            <div className="form-grid">
              <Field
                label="Timezone"
                required
                hint="An IANA timezone, such as UTC or America/New_York."
              >
                <select
                  required
                  value={value.timezone}
                  onChange={e => set("timezone", e.target.value)}
                >
                  {!timezones.includes(value.timezone) && (
                    <option value={value.timezone}>{value.timezone}</option>
                  )}
                  {timezones.map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Default currency"
                required
                hint="Three-letter currency code, e.g. USD or EUR."
              >
                <input
                  required
                  minLength={3}
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  value={value.defaultCurrency}
                  onChange={e =>
                    set("defaultCurrency", e.target.value.toUpperCase())
                  }
                />
              </Field>
              <Field label="Description" wide>
                <textarea
                  rows={5}
                  maxLength={10000}
                  value={value.description}
                  onChange={e => set("description", e.target.value)}
                  placeholder="Company overview entered by your team"
                />
              </Field>
            </div>
          </Section>
        </fieldset>
        <div className="form-actions">
          <div className="company-updated">
            Last updated: {formatDate(company.data?.updatedAt, true)}
            {company.data?.updatedBy && (
              <small>Updated by account {company.data.updatedBy}</small>
            )}
          </div>
          {canEdit ? (
            <Button type="submit" busy={busy} disabled={!dirty}>
              <Save size={16} />
              Save company information
            </Button>
          ) : (
            <span className="muted">Read-only access</span>
          )}
        </div>
      </form>
      <RegionMapping
        reference={reference.data}
        reload={reference.reload}
        canEdit={canEdit}
      />
    </>
  );
}
function RegionMapping({
  reference,
  reload,
  canEdit,
}: {
  reference: Reference | null;
  reload: () => void;
  canEdit: boolean;
}) {
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = reference?.countries.find(c => c.code === country);
  useEffect(() => {
    setRegion(current?.regionCode ?? "");
  }, [country, current?.regionCode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/reference/countries/${country}`, {
        method: "PUT",
        body: { regionCode: region },
      });
      toast.success("Country-region mapping updated.");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Country & business region mapping"
      description="Configure geographic groupings used by customer records. Turkey and Egypt are countries, not regions. No pricing is configured."
    >
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} className="mapping-form">
        <Field label="Country">
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            disabled={!canEdit || busy}
          >
            <option value="">Select a country to configure</option>
            {reference?.countries.map(c => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Business region">
          <select
            required
            value={region}
            onChange={e => setRegion(e.target.value)}
            disabled={!country || !canEdit || busy}
          >
            <option value="">Select a region</option>
            {reference?.regions.map(r => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Button
          type="submit"
          variant="secondary"
          busy={busy}
          disabled={
            !canEdit || !country || !region || region === current?.regionCode
          }
        >
          Update mapping
        </Button>
      </form>
    </Section>
  );
}
