import type { ServiceRow } from "../_lib/types"
import styles from "../admin.module.css"

export function ServiceSelect({
  services,
  value,
  onChange,
}: {
  services: ServiceRow[]
  value: string | null
  onChange: (serviceId: string) => void
}) {
  return (
    <select
      className={styles.select}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Service"
    >
      {services.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
