import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listUsers, listMasterData } from "@/server/services/admin";
import { ROLE_LABELS, capabilitiesOf, GROUP_WIDE_ROLES } from "@/domain/permissions";
import { ROLES } from "@/db/schema";
import { formatDateTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AdminTabs } from "./AdminTabs";
import { saveUserAction } from "./actions";

export const metadata = { title: "Users & access" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("admin.users");
  const editId = first((await searchParams).edit);
  const db = await getDb();
  const [users, md] = await Promise.all([listUsers(db, actor), listMasterData(db)]);
  const editing = users.find((u) => u.id === editId);
  const dname = (id: string) => md.dealerships.find((d) => d.id === id)?.name ?? "?";

  return (
    <>
      <PageHeader title="Administration" subtitle="Users, roles and dealership access. Every change is audited." />
      <AdminTabs current="/admin" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={`Users (${users.length})`} bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
            <thead className="border-b border-line"><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Dealership access</th><th className="th">Last sign-in</th><th className="th" /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="td"><div className="font-medium">{u.name}</div><div className="text-xs text-ink-3">{u.email}</div></td>
                  <td className="td">{ROLE_LABELS[u.role]}{!u.active && <Chip tone="neutral" className="ml-1">Inactive</Chip>}</td>
                  <td className="td text-xs">{GROUP_WIDE_ROLES.includes(u.role) ? "All dealerships" : u.dealershipIds.map(dname).join(", ") || <span className="text-crit">None</span>}</td>
                  <td className="td text-xs">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="td"><Link href={`/admin?edit=${u.id}`} className="text-petrol text-sm hover:underline">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Panel>
        <Panel title={editing ? `Edit ${editing.name}` : "Add a user"} actions={editing ? <Link href="/admin" className="btn-ghost btn-sm">New user</Link> : undefined}>
          <ActionForm action={saveUserAction} className="space-y-3" key={editing?.id ?? "new"}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <label className="block"><span className="label">Name</span><input name="name" defaultValue={editing?.name} required className="field" /></label>
            <label className="block"><span className="label">Work email</span><input name="email" type="email" defaultValue={editing?.email} required className="field" /></label>
            <label className="block"><span className="label">Role</span><select name="role" defaultValue={editing?.role ?? "service_advisor"} className="field">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
            <fieldset><legend className="label">Dealership access (location-bound roles)</legend>
              <div className="grid grid-cols-2 gap-1 text-sm">{md.dealerships.map((d) => <label key={d.id} className="flex items-center gap-1.5"><input type="checkbox" name="dealershipIds" value={d.id} defaultChecked={editing?.dealershipIds.includes(d.id)} />{d.name}</label>)}</div>
              <p className="text-xs text-ink-3 mt-1">MD, group finance and administrators are group-wide.</p>
            </fieldset>
            <label className="block"><span className="label">{editing ? "New password (leave blank to keep)" : "Initial password"}</span><input name="password" type="password" autoComplete="new-password" minLength={10} className="field" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active</label>
            <Submit>{editing ? "Save user" : "Add user"}</Submit>
          </ActionForm>
        </Panel>
      </div>
      <Panel className="mt-4" title="Role permissions" subtitle="Suggested least-privilege matrix from the brief, to be validated with Kun">
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[720px]">
          <tbody>{ROLES.map((r) => <tr key={r} className="border-b border-line last:border-0"><td className="td font-medium w-56">{ROLE_LABELS[r]}</td><td className="td text-ink-2">{capabilitiesOf(r).join(" · ")}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
