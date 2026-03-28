import { Toolbar } from "@/components/Toolbar";
import { Layout } from "@/components/Layout";
import { BpmProvider } from "@/hooks/useBpm";

export default function App() {
  return (
    <BpmProvider>
      <div className="flex flex-col h-screen bg-bg-primary">
        <Toolbar />
        <Layout />
      </div>
    </BpmProvider>
  );
}
