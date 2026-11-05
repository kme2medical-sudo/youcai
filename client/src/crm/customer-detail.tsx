import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  Archive,
  ArrowRight,
  Building2,
  Globe2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, useResource } from "./api";
import { useAuth } from "./session";
import {
  SALUTATIONS,
  hasPermission,
  type Contact,
  type Customer,
  type Reference,
} from "./types";
import {
  Badge,
  Button,
  DataValue,
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  LinkButton,
  Loading,
  Modal,
  Notice,
  PageHeader,
  safeWebsite,
  Section,
  StatusBadge,
} from "./ui";

export function CustomerDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const reference = useResource<Reference>("/reference");
  const record = useResource<{ customer: Customer; contacts: Contact[] }>(
    `/customers/${id}`
  );
  const [contactEdit, setContactEdit] = useState<Contact | "new" | null>(null);
  const [contactDelete, setContactDelete] = useState<Contact | null>(null);
  const [archiveDialog, setArchiveDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (record.loading) return <Loading label="Loading customer record…" />;
  if (record.error)
    return <ErrorState error={record.error} retry={record.reload} />;
  if (!record.data) return null;
  const { customer, contacts } = record.data;
  const archived = customer.status === "ARCHIVED";
  const canContacts = hasPermission(user, "contacts.manage") && !archived;
  const country =
    reference.data?.countries.find(c => c.code === customer.countryCode)
      ?.name ?? customer.countryCode;
  const region =
    reference.data?.regions.find(r => r.code === customer.regionCode)?.name ??
    customer.regionCode;
  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${id}/archive`, {
        method: "POST",
        body: { archived: !archived },
      });
      toast.success(archived ? "Customer restored." : "Customer archived.");
      setArchiveDialog(false);
      record.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeContact() {
    if (!contactDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${id}/contacts/${contactDelete.id}`, {
        method: "DELETE",
      });
      toast.success("Contact removed.");
      setContactDelete(null);
      record.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER RECORD"
        title={customer.displayName}
        description={
          customer.legalName ||
          "Account details and the people behind your relationship."
        }
        back={{ href: "/customers", label: "Back to customers" }}
        action={
          <>
            {hasPermission(user, "customers.archive") && (
              <Button
                variant="secondary"
                onClick={() => {
                  setArchiveDialog(true);
                  setError(null);
                }}
              >
                {archived ? <RotateCcw size={16} /> : <Archive size={16} />}
                {archived ? "Restore customer" : "Archive"}
              </Button>
            )}
            {hasPermission(user, "customers.update") && !archived && (
              <LinkButton href={`/customers/${id}/edit`}>
                <Pencil size={16} />
                Edit customer
              </LinkButton>
            )}
          </>
        }
      />
      <div className="customer-overview-bar">
        <StatusBadge status={customer.status} />
        <span>
          <Building2 size={15} />
          {customer.customerType}
        </span>
        <span>
          <Globe2 size={15} />
          {country}
        </span>
        <span className="overview-updated">
          Updated {formatDate(customer.updatedAt)}
        </span>
      </div>
      {archived && (
        <Notice>
          This customer is archived and retained for reference. Restore it to
          mark the relationship active again and edit its information or
          contacts.
          {!hasPermission(user, "customers.archive") &&
            " An administrator can restore this record."}
        </Notice>
      )}
      <div className="customer-detail-columns">
        <div className="detail-main">
          <Section
            title="Account information"
            description="Business identity, contact details and regional context."
          >
            <dl className="detail-grid">
              <DataValue label="Customer name">
                {customer.displayName}
              </DataValue>
              <DataValue label="Legal name">{customer.legalName}</DataValue>
              <DataValue label="Customer type">
                {customer.customerType}
              </DataValue>
              <DataValue label="Legal entity type">
                {customer.legalEntityType}
              </DataValue>
              <DataValue label="Country">
                {country}{" "}
                <span className="subtle-code">{customer.countryCode}</span>
              </DataValue>
              <DataValue label="Business region">{region}</DataValue>
              <DataValue label="General email">
                {customer.email && (
                  <a href={`mailto:${customer.email}`}>{customer.email}</a>
                )}
              </DataValue>
              <DataValue label="Phone">
                {customer.phone && (
                  <a href={`tel:${customer.phone}`}>{customer.phone}</a>
                )}
              </DataValue>
              <DataValue label="Website">
                {customer.website &&
                  (safeWebsite(customer.website) ? (
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={safeWebsite(customer.website)!}
                    >
                      {customer.website}
                    </a>
                  ) : (
                    customer.website
                  ))}
              </DataValue>
              <DataValue label="Tax ID">{customer.taxId}</DataValue>
            </dl>
          </Section>
          <Section
            title="Customer contacts"
            description="The people behind the account. A customer can have zero or one primary contact."
            action={
              canContacts ? (
                <Button
                  variant="secondary"
                  onClick={() => setContactEdit("new")}
                >
                  <Plus size={16} />
                  Add contact
                </Button>
              ) : undefined
            }
          >
            {contacts.length === 0 ? (
              <EmptyState
                title="No contacts added yet."
                description="Add the people you work with—their role, direct details, and preferred primary contact."
                action={
                  canContacts ? (
                    <Button
                      variant="secondary"
                      onClick={() => setContactEdit("new")}
                    >
                      <Plus size={16} />
                      Add first contact
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="contacts-list">
                {contacts.map(contact => (
                  <article className="contact-card" key={contact.id}>
                    <span className="contact-avatar">
                      <UserRound size={21} />
                    </span>
                    <div className="contact-content">
                      <div className="contact-name">
                        <h3>
                          {contact.salutation ? `${contact.salutation} ` : ""}
                          {contact.fullName}
                        </h3>
                        {contact.isPrimary && (
                          <Badge tone="green">
                            <Star size={11} />
                            Primary
                          </Badge>
                        )}
                      </div>
                      <p>
                        {[
                          contact.jobTitle,
                          contact.alias ? `Known as ${contact.alias}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No position specified"}
                      </p>
                      <div className="contact-links">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`}>
                            <Mail size={13} />
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`}>
                            <Phone size={13} />
                            {contact.phone}
                          </a>
                        )}
                        {!contact.email && !contact.phone && (
                          <span className="muted">
                            No direct contact details provided
                          </span>
                        )}
                      </div>
                    </div>
                    {canContacts && (
                      <div className="contact-actions">
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${contact.fullName}`}
                          onClick={() => setContactEdit(contact)}
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Remove ${contact.fullName}`}
                          onClick={() => {
                            setContactDelete(contact);
                            setError(null);
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Section>
          <Section title="Relationship notes">
            <div className="notes-content">
              {customer.notes || (
                <span className="muted">
                  No relationship notes have been added.
                </span>
              )}
            </div>
          </Section>
        </div>
        <div className="detail-aside">
          <Section title="Address">
            <div className="address-content">
              <MapPin size={21} />
              <div>
                {[
                  customer.addressLine1,
                  customer.addressLine2,
                  [customer.city, customer.state, customer.postalCode]
                    .filter(Boolean)
                    .join(", "),
                  country,
                ]
                  .filter(Boolean)
                  .map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
              </div>
            </div>
          </Section>
          <Section title="Record details">
            <dl className="record-details">
              <DataValue label="Created">
                {formatDate(customer.createdAt, true)}
              </DataValue>
              <DataValue label="Last updated">
                {formatDate(customer.updatedAt, true)}
              </DataValue>
              <DataValue label="Customer ID">
                <span className="mono">{customer.id}</span>
              </DataValue>
            </dl>
            <div className="panel-note">
              Customer records do not create user accounts or grant workspace
              access.
            </div>
          </Section>
        </div>
      </div>
      {contactEdit && (
        <ContactModal
          customerId={id}
          contact={contactEdit === "new" ? undefined : contactEdit}
          onClose={() => setContactEdit(null)}
          onSaved={() => {
            setContactEdit(null);
            record.reload();
          }}
        />
      )}
      {contactDelete && (
        <Modal
          title="Remove this contact?"
          onClose={() => {
            if (!busy) setContactDelete(null);
          }}
        >
          <p className="modal-description">
            Remove <strong>{contactDelete.fullName}</strong> from{" "}
            {customer.displayName}. This removes the contact record and cannot
            be undone.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setContactDelete(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={removeContact}>
              Remove contact
            </Button>
          </div>
        </Modal>
      )}
      {archiveDialog && (
        <Modal
          title={archived ? "Restore this customer?" : "Archive this customer?"}
          onClose={() => {
            if (!busy) setArchiveDialog(false);
          }}
        >
          <p className="modal-description">
            {archived
              ? "The customer will be marked active again. All existing information and contacts will be retained."
              : "The record and its contacts will remain available for reference. You can restore this customer later. No record will be permanently deleted."}
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="modal-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setArchiveDialog(false)}
            >
              Cancel
            </Button>
            <Button busy={busy} onClick={archive}>
              {archived ? "Restore customer" : "Archive customer"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ContactModal({
  customerId,
  contact,
  onClose,
  onSaved,
}: {
  customerId: string;
  contact?: Contact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState({
    salutation: contact?.salutation ?? "",
    fullName: contact?.fullName ?? "",
    alias: contact?.alias ?? "",
    jobTitle: contact?.jobTitle ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    isPrimary: !!contact?.isPrimary,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function set(key: Exclude<keyof typeof value, "isPrimary">, v: string) {
    setValue(old => ({ ...old, [key]: v }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(
        `/customers/${customerId}/contacts${contact ? `/${contact.id}` : ""}`,
        {
          method: contact ? "PUT" : "POST",
          body: { ...value, salutation: value.salutation || null },
        }
      );
      toast.success(contact ? "Contact updated." : "Contact added.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={contact ? "Edit contact" : "Add customer contact"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="form-grid modal-form-grid">
          <Field label="Salutation / attribution">
            <select
              value={value.salutation}
              onChange={e => set("salutation", e.target.value)}
            >
              <option value="">Not specified</option>
              {SALUTATIONS.map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Full name" required>
            <input
              required
              maxLength={160}
              value={value.fullName}
              onChange={e => set("fullName", e.target.value)}
            />
          </Field>
          <Field label="Alias">
            <input
              maxLength={120}
              value={value.alias}
              onChange={e => set("alias", e.target.value)}
            />
          </Field>
          <Field label="Job title / position">
            <input
              maxLength={160}
              value={value.jobTitle}
              onChange={e => set("jobTitle", e.target.value)}
              placeholder="e.g. Purchasing Director"
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
          <Field label="Email">
            <input
              type="email"
              maxLength={254}
              value={value.email}
              onChange={e => set("email", e.target.value)}
            />
          </Field>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={value.isPrimary}
            onChange={e =>
              setValue(old => ({ ...old, isPrimary: e.target.checked }))
            }
          />
          <span>
            <strong>Primary contact</strong>
            <small>
              Making this contact primary will unset any existing primary
              contact. Leaving it off allows zero primary contacts.
            </small>
          </span>
        </label>
        <div className="modal-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {contact ? "Save contact" : "Add contact"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
