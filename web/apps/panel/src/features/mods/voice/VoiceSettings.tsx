import type { VoiceSettings as Settings } from '@isle/api';
import { Field, FieldGrid, Hint, Mono, SectionTitle, Select } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

const MODES: ReadonlyArray<{ value: Settings['nameMode']; label: string; help: string }> = [
  { value: 'name', label: 'Hiện tên trong game', help: 'Danh sách "Đang nói gần bạn" hiện tên trong game của người nói.' },
  { value: 'id', label: 'Chỉ hiện mã (#A3F9)', help: 'Chỉ hiện một mã ngắn (ví dụ #A3F9), cùng một người luôn cùng mã, nên vẫn tắt tiếng / chỉnh âm lượng từng người được, nhưng không biết là ai.' },
  { value: 'none', label: 'Không hiện gì', help: 'Chỉ hiện "Có người đang nói" kèm gần / xa, trái / phải, không tên, không mã. Hợp với server nhập vai.' },
];

/** Mods → Voice gần: what players see of who is talking near them (bridge/src/voice-settings.ts). */
export function VoiceSettings() {
  const form = useSettingsForm<Settings>('/api/voice-settings', { label: 'Voice gần', href: '#mods/voice', toBody: (d) => ({ nameMode: d.nameMode }), saved: 'Đã lưu, danh sách người đang nói đổi ngay.' });
  const d = form.draft;
  return (
    <>
      <SectionTitle first icon="🎙" title="Cấu hình · Voice gần" sub="lưu riêng, có hiệu lực ngay" />
      <SettingsPage form={form}>
        {d && (
          <>
            <Hint>{d.enabled
              ? <>Voice đang bật · máy chủ <Mono>{d.url ?? ''}</Mono>. Tên trong kênh đổi theo cài đặt này từ lần vào kênh kế tiếp của mỗi người; danh sách "đang nói" đổi ngay.</>
              : 'Voice chưa bật trên bridge (thiếu LIVEKIT_API_KEY / LIVEKIT_API_SECRET), cài đặt vẫn lưu được.'}</Hint>
            <FieldGrid>
              <Field label="Người chơi thấy gì về người đang nói gần họ" keyName="nameMode" htmlFor="vs-name-mode"
                hint={MODES.find((m) => m.value === d.nameMode)?.help}>
                <Select id="vs-name-mode" value={d.nameMode} options={MODES} onChange={(v) => form.set('nameMode', v)} />
              </Field>
            </FieldGrid>
          </>
        )}
      </SettingsPage>
    </>
  );
}
