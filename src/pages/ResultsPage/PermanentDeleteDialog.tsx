import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ISimilarGroup } from '@/data/similarity';
import { formatBytes } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function PermanentDeleteDialog({ groups, disabled, hiddenCount, onDelete }: {
  groups: ISimilarGroup[];
  disabled: boolean;
  hiddenCount: number;
  onDelete: (scopeIds: string[], selectedIds: string[], confirmation: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<ISimilarGroup[] | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const submittingRef = useRef(false);
  const files = (snapshot ?? []).flatMap((group) => group.files.filter((file) => file.selected));
  const missingConfirmation = confirmation !== '删除';
  const errors = [
    ...(missingConfirmation ? [{ id: 'delete-confirmation-error', message: '请在输入框中准确输入“删除”两个字。' }] : []),
    ...(files.length === 0 ? [{ id: 'delete-selection-error', message: '当前没有待删除文件，请取消并重新勾选文件。' }] : []),
  ];
  const canConfirm = errors.length === 0 && !submitting;
  const showErrors = attempted && errors.length > 0;
  // Darken the existing danger color so small warning text stays readable.
  const warningTextClass = 'text-[color-mix(in_srgb,var(--destructive),black_20%)]';
  return (
    <>
      <Button variant="destructive" disabled={disabled} onClick={() => {
        setConfirmation(''); setAttempted(false); setSnapshot(groups);
      }}><Trash2 className="size-4" />删除文件</Button>
      <AlertDialog open={snapshot !== null} onOpenChange={(open) => { if (!open && !submitting) setSnapshot(null); }}>
        <AlertDialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {files.length} 个文件？</AlertDialogTitle>
            <AlertDialogDescription>
              这将删除电脑上的真实文件，<strong className={warningTextClass}>不进入系统回收站</strong>，无法撤销。请先备份重要图片。
              删除期间请勿在其他软件中编辑、移动或替换本目录文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            仅删除下方清单中的文件，共 {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}。
            {hiddenCount > 0 && <span> 隐藏组另有 {hiddenCount} 个勾选项，不会删除。</span>}
            <p className="mt-1">每组至少保留一份；文件或保留项变化时会跳过，不自动重试。</p>
          </div>
          <ul aria-label="本次删除文件清单" className="max-h-48 overflow-y-auto divide-y rounded-lg border px-3 text-xs">
            {files.map((file) => <li key={file.id} className="py-2 break-all"><span>{file.relativePath}</span><span className="ml-2 text-muted-foreground">{formatBytes(file.size)}</span></li>)}
          </ul>
          <div className="space-y-2">
            <label htmlFor="permanent-delete-confirmation" className="text-sm font-medium">输入“删除”以确认</label>
            <Input id="permanent-delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="删除"
              disabled={submitting} aria-invalid={attempted && missingConfirmation}
              aria-describedby={attempted && missingConfirmation ? 'delete-confirmation-error' : undefined} />
          </div>
          {showErrors && <div id="delete-validation-errors" role="alert" className={`rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm ${warningTextClass}`}>
            <p className="font-semibold">尚未满足以下条件：</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {errors.map((error) => <li key={error.id} id={error.id}>{error.message}</li>)}
            </ul>
          </div>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={submitting} aria-disabled={!canConfirm}
              aria-describedby={showErrors ? 'delete-validation-errors' : undefined}
              className={!canConfirm ? 'bg-muted text-muted-foreground border-border' : undefined}
              onClick={async () => {
                if (submittingRef.current || !snapshot) return;
                if (!canConfirm) { setAttempted(true); return; }
                submittingRef.current = true;
                setSubmitting(true);
                try {
                  await onDelete(snapshot.map((group) => group.id), files.map((file) => file.id), confirmation);
                  setSnapshot(null);
                } finally { submittingRef.current = false; setSubmitting(false); }
              }}>确认</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
