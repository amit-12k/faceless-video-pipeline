import {
  Activity, AppWindow, Archive, Bell, Box, Bug, ChartColumn, CircleCheck, Clock, Cloud, Code, Container, Cpu,
  Database, DollarSign, FileText, Fingerprint, Gauge, Globe, HardDrive, KeyRound, Layers, ListOrdered, Lock, Mail,
  MessageSquare, Network, Plug, RefreshCw, Rocket, Scale, Search, Server, Settings, ShieldCheck, Smartphone, Split,
  SquareFunction, Terminal, Ticket, TriangleAlert, User, Users, Webhook, Workflow, Zap
} from "lucide-react";

// Keys must match ELEMENT_KINDS in src/schemas.mjs.
export const KIND_ICONS = {
  user: User, users: Users, browser: AppWindow, mobile: Smartphone, server: Server, database: Database,
  cache: Zap, storage: HardDrive, file: FileText, api: Plug, queue: ListOrdered, "load-balancer": Split,
  cdn: Globe, cloud: Cloud, network: Network, lock: Lock, key: KeyRound, security: ShieldCheck, token: Ticket,
  code: Code, terminal: Terminal, function: SquareFunction, container: Container, settings: Settings,
  time: Clock, metrics: ChartColumn, bug: Bug, email: Mail, notification: Bell, compute: Cpu, search: Search,
  success: CircleCheck, warning: TriangleAlert, deploy: Rocket, cost: DollarSign, package: Box, layers: Layers,
  performance: Gauge, sync: RefreshCw, workflow: Workflow, webhook: Webhook, archive: Archive,
  identity: Fingerprint, monitoring: Activity, message: MessageSquare, scale: Scale
};

export const iconForKind = (kind) => KIND_ICONS[kind] || Box;
