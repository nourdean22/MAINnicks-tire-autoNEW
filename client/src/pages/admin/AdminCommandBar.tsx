/**
 * AdminCommandBar — Ctrl+K command palette for quick navigation and search.
 * Uses existing shadcn/ui Command component (cmdk).
 */
import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import { NAV_GROUPS, type AdminSection } from "./shared";
import { ExternalLink, Search, User } from "lucide-react";

interface Props {
  onNavigate: (section: AdminSection) => void;
}

export default function AdminCommandBar({ onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Customer search — only fires when search is 3+ chars
  const shouldSearch = search.length >= 3;
  const { data: customers } = trpc.customers.list.useQuery(
    { search, page: 1, pageSize: 5 },
    { enabled: shouldSearch },
  );

  // Ctrl+K / Cmd+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = useCallback((section: AdminSection) => {
    onNavigate(section);
    setOpen(false);
    setSearch("");
  }, [onNavigate]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Admin Command Bar" description="Search sections, customers, or quick actions">
      <CommandInput
        placeholder="Search sections, customers..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Quick Actions */}
        <CommandGroup heading="Quick Actions">
          <CommandItem onSelect={() => go("bookings")}>
            <Search className="w-4 h-4" />
            <span>New Booking</span>
            <CommandShortcut>Bookings</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("sms")}>
            <Search className="w-4 h-4" />
            <span>Send SMS</span>
            <CommandShortcut>SMS</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => {
            window.open("https://autonicks.com", "_blank");
            setOpen(false);
          }}>
            <ExternalLink className="w-4 h-4" />
            <span>Open NOUR OS</span>
            <CommandShortcut>External</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {/* Nav Sections */}
        {NAV_GROUPS.map(group => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map(item => (
              <CommandItem key={item.id} onSelect={() => go(item.id)}>
                {item.icon}
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {/* Customer Search Results */}
        {shouldSearch && customers?.customers && customers.customers.length > 0 && (
          <CommandGroup heading="Customers">
            {customers.customers.map((c: any) => (
              <CommandItem key={c.id} onSelect={() => go("customers")}>
                <User className="w-4 h-4" />
                <span>{c.firstName} {c.lastName}</span>
                {c.phone && <CommandShortcut>{c.phone}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
