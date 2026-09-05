import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { DiagnosticResult } from '@/lib/hash-diagnostics';
import license from '@/lib/hash-wasm-LICENSE.txt?raw';

export default function DiagnosticsPage() {
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [message, setMessage] = useState('尚未开始');
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setAgent(navigator.userAgent);
    const hidden = () => { if (document.hidden) active.current?.abort(); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      const run = active.current; active.current = null; run?.abort();
    };
  }, []);
  async function start() {
    if (active.current) return;
    const run = new AbortController(); active.current = run;
    setBusy(true); setResults([]); setMessage('正在准备自检…');
    try {
      const [{ runHashDiagnostics }, { diagnosticService }] = await Promise.all([
        import('@/lib/hash-diagnostics'), import('@/lib/hash-diagnostics-browser'),
      ]);
      await runHashDiagnostics(diagnosticService, run.signal, (label, rows) => {
        if (active.current === run) { setMessage(label); setResults(rows); }
      });
      if (active.current === run) setMessage('自检完成。请将下方结果和浏览器信息截图发给开发者。');
    } catch (error) {
      if (active.current === run) setMessage(run.signal.aborted ? '自检已停止。请保持本页在前台，可重新开始。'
        : `自检未完成：${error instanceof Error ? error.message : '无法加载测试程序'}`);
    } finally {
      if (active.current === run) { active.current = null; setBusy(false); }
    }
  }
  return <div className="max-w-4xl mx-auto px-4 md:px-6 py-10 space-y-6">
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">性能自检</h1>
      <p className="text-muted-foreground">只计算程序生成的测试数据，不选择、不读取、不删除照片，也不会申请文件权限。</p>
      <p className="text-sm text-muted-foreground">请暂停其他繁重操作，并保持本页在前台。自检对照不同 SHA-256 实现，不改变当前应用的删除方式。</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={start} disabled={busy}>{busy ? '自检中…' : '开始自检'}</Button>
        {busy && <Button variant="outline" onClick={() => active.current?.abort()}>停止自检</Button>}
        <Button variant="ghost" asChild><Link to="/">返回首页</Link></Button>
      </div>
      <p role="status" aria-live="polite">{message}</p>
    </div>
    <Card><CardContent className="p-5 space-y-3">
      <h2 className="font-semibold">浏览器信息</h2>
      <p className="text-sm break-all text-muted-foreground">{agent || '正在读取浏览器版本…'}</p>
      <p className="text-xs text-muted-foreground">自检信息只在当前页面显示，不自动上传或保存。</p>
    </CardContent></Card>
    <Card><CardContent className="p-5 space-y-4">
      <h2 className="font-semibold">计算对照结果</h2>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <thead><tr className="border-b"><th className="p-2">方式 / 轮次</th><th className="p-2">用时</th><th className="p-2">吞吐量</th><th className="p-2">核验</th></tr></thead>
        <tbody>{results.map(row => <tr key={`${row.engine}-${row.threads}-${row.round}`} className="border-b last:border-0">
          <td className="p-2">{row.label} / {row.round}</td>
          <td className="p-2 tabular-nums whitespace-nowrap">{row.seconds === undefined ? '—' : `${row.seconds.toFixed(3)} 秒`}</td>
          <td className="p-2 tabular-nums whitespace-nowrap">{row.mibPerSecond === undefined ? '—' : `${row.mibPerSecond.toFixed(1)} MiB/s`}</td>
          <td className="p-2">{row.status === 'passed' ? '指纹一致' : row.message}</td>
        </tr>)}</tbody>
      </table></div>
      {!results.length && <p className="text-sm text-muted-foreground">点击“开始自检”后显示结果。</p>}
      <p className="text-xs text-muted-foreground">每项计时均完整处理 32 MiB 合成数据，预热及启动不计入，分两轮反向顺序测试。这里只测计算吞吐，不代表磁盘读取或删除用时；结果不自动切换删除引擎。</p>
    </CardContent></Card>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">第三方组件许可</summary>
      <pre className="mt-3 whitespace-pre-wrap break-words">{license}</pre>
    </details>
  </div>;
}
