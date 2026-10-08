import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { font, useAdminLayout, useAdminTheme } from "./theme";
import { DataTable, type Column } from "./ui";

export type MobileRow = { title: string; subtitle?: string | null; meta?: string | null; badges?: ReactNode; actions?: ReactNode; leading?: ReactNode };

/** Tableau sur ordinateur, liste empilée sur téléphone. */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  renderCell,
  mobileRow,
  minWidth,
  onRowPress,
}: {
  columns: readonly Column[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  renderCell: (row: T, key: string) => ReactNode;
  mobileRow: (row: T) => MobileRow;
  minWidth?: number;
  onRowPress?: (row: T) => void;
}) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  if (desktop) return <DataTable columns={columns} rows={rows} rowKey={rowKey} renderCell={renderCell} minWidth={minWidth} onRowPress={onRowPress} />;
  return (
    <>
      {rows.map((row, index) => {
        const item = mobileRow(row);
        return (
          <View key={rowKey(row)} style={[styles.row, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
            <View style={styles.top}>
              {item.leading}
              <View style={styles.flex}>
                <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
                {item.subtitle ? <Text style={[styles.meta, { color: theme.textSecondary }]}>{item.subtitle}</Text> : null}
              </View>
            </View>
            {item.meta ? <Text style={[styles.meta, { color: theme.textMuted }]}>{item.meta}</Text> : null}
            {item.badges ? <View style={styles.wrap}>{item.badges}</View> : null}
            {item.actions ? <View style={styles.wrap}>{item.actions}</View> : null}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { padding: 16, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: font.md, fontWeight: "600" },
  meta: { fontSize: font.xs, lineHeight: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
