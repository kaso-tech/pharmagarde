import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { PropsWithChildren, ReactNode, useState } from "react";
import { ActivityIndicator, Modal, Pressable, type PressableStateCallbackType, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import { font, radius, toneColors, useAdminLayout, useAdminTheme, type Tone } from "./theme";

export type IconName = keyof typeof MaterialIcons.glyphMap;

/** État de survol fourni par react-native-web (absent des types React Native). */
export function isHovered(state: PressableStateCallbackType) {
  return Boolean((state as PressableStateCallbackType & { hovered?: boolean }).hovered);
}

// ─── Boutons ────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ label, icon, variant = "secondary", size = "md", onPress, disabled = false, loading = false, accessibilityLabel, style }: { label: string; icon?: IconName; variant?: ButtonVariant; size?: "sm" | "md"; onPress?: () => void; disabled?: boolean; loading?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useAdminTheme();
  const inactive = disabled || loading;
  const colors = {
    primary: { bg: theme.brand, hover: theme.brandStrong, fg: theme.onBrand, border: theme.brand },
    secondary: { bg: theme.surface, hover: theme.surfaceMuted, fg: theme.textSecondary, border: theme.borderStrong },
    ghost: { bg: "transparent", hover: theme.surfaceMuted, fg: theme.textSecondary, border: "transparent" },
    danger: { bg: theme.danger, hover: theme.danger, fg: "#FFFFFF", border: theme.danger },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={(state) => [
        styles.button,
        size === "sm" && styles.buttonSm,
        { backgroundColor: isHovered(state) && !inactive ? colors.hover : colors.bg, borderColor: colors.border },
        variant === "primary" || variant === "danger" ? styles.buttonShadow : undefined,
        inactive && styles.disabled,
        state.pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.fg} /> : icon ? <MaterialIcons name={icon} size={size === "sm" ? 16 : 18} color={colors.fg} /> : null}
      <Text numberOfLines={1} style={[styles.buttonText, size === "sm" && styles.buttonTextSm, { color: colors.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, tone = "neutral", disabled = false, size = 34 }: { icon: IconName; label: string; onPress: () => void; tone?: Tone; disabled?: boolean; size?: number }) {
  const theme = useAdminTheme();
  const color = tone === "neutral" ? theme.textMuted : toneColors(theme, tone).fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...({ title: label } as object)}
      style={(state) => [styles.iconButton, { width: size, height: size, borderColor: theme.border, backgroundColor: isHovered(state) ? theme.surfaceMuted : theme.surface }, disabled && styles.disabled, state.pressed && styles.pressed]}
    >
      <MaterialIcons name={icon} size={18} color={color} />
    </Pressable>
  );
}

// ─── Badges, avatars, alertes ───────────────────────────────────────────────

export function Badge({ label, tone = "neutral", icon, dot = false }: { label: string; tone?: Tone; icon?: IconName; dot?: boolean }) {
  const theme = useAdminTheme();
  const { fg, bg } = toneColors(theme, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {dot ? <View style={[styles.badgeDot, { backgroundColor: fg }]} /> : null}
      {icon ? <MaterialIcons name={icon} size={13} color={fg} /> : null}
      <Text numberOfLines={1} style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ label, size = 32, tone = "brand" }: { label: string; size?: number; tone?: Tone }) {
  const theme = useAdminTheme();
  const { fg, bg } = toneColors(theme, tone);
  // Un compte sans nom s'affiche par son téléphone ou son e-mail : pas d'initiales dans ce cas.
  const initials = /^[+\d]|@/.test(label) ? "" : label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toLocaleUpperCase("fr")).join("");
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {initials ? <Text style={[styles.avatarText, { color: fg, fontSize: size * 0.38 }]}>{initials}</Text> : <MaterialIcons name="person" size={size * 0.55} color={fg} />}
    </View>
  );
}

function isTextContent(node: ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") return true;
  return Array.isArray(node) && node.every((child) => typeof child === "string" || typeof child === "number" || child === null || child === undefined || child === false);
}

export function Alert({ tone = "info", icon, title, children }: PropsWithChildren<{ tone?: Tone; icon?: IconName; title?: string }>) {
  const theme = useAdminTheme();
  const { fg, bg } = toneColors(theme, tone);
  return (
    <View style={[styles.alert, { backgroundColor: bg, borderColor: fg }]}>
      <MaterialIcons name={icon ?? (tone === "danger" ? "error-outline" : tone === "warning" ? "warning-amber" : tone === "success" ? "check-circle-outline" : "info-outline")} size={20} color={fg} />
      <View style={styles.alertBody}>
        {title ? <Text style={[styles.alertTitle, { color: theme.text }]}>{title}</Text> : null}
        {isTextContent(children) ? <Text style={[styles.alertText, { color: theme.textSecondary }]}>{children}</Text> : children}
      </View>
    </View>
  );
}

// ─── Mise en page ───────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  return (
    <View style={[styles.pageHeader, desktop && styles.pageHeaderDesktop]}>
      <View style={styles.flex}>
        {desktop ? <Text accessibilityRole="header" style={[styles.pageTitle, { color: theme.text }]}>{title}</Text> : null}
        {description ? <Text style={[styles.pageDescription, { color: theme.textMuted }]}>{description}</Text> : null}
      </View>
      {actions ? <View style={styles.pageActions}>{actions}</View> : null}
    </View>
  );
}

export function Card({ title, description, actions, children, padded = true, style, footer }: PropsWithChildren<{ title?: string; description?: string; actions?: ReactNode; padded?: boolean; style?: StyleProp<ViewStyle>; footer?: ReactNode }>) {
  const theme = useAdminTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }, style]}>
      {title || actions ? (
        <View style={[styles.cardHeader, { borderBottomColor: theme.border }]}>
          <View style={styles.flex}>
            {title ? <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>{title}</Text> : null}
            {description ? <Text style={[styles.cardDescription, { color: theme.textMuted }]}>{description}</Text> : null}
          </View>
          {actions ? <View style={styles.cardActions}>{actions}</View> : null}
        </View>
      ) : null}
      <View style={padded ? styles.cardBody : undefined}>{children}</View>
      {footer ? <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>{footer}</View> : null}
    </View>
  );
}

export function KpiCard({ label, value, icon, tone = "brand", hint, onPress }: { label: string; value: string; icon: IconName; tone?: Tone; hint?: string; onPress?: () => void }) {
  const theme = useAdminTheme();
  const { fg, bg } = toneColors(theme, tone);
  const content = (
    <>
      <View style={styles.kpiTop}>
        <Text style={[styles.kpiLabel, { color: theme.textMuted }]}>{label}</Text>
        <View style={[styles.kpiIcon, { backgroundColor: bg }]}><MaterialIcons name={icon} size={18} color={fg} /></View>
      </View>
      <Text style={[styles.kpiValue, { color: theme.text }]}>{value}</Text>
      {hint ? <Text numberOfLines={1} style={[styles.kpiHint, { color: theme.textMuted }]}>{hint}</Text> : null}
    </>
  );
  const base = [styles.card, styles.kpiCard, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }];
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} : ${value}`} onPress={onPress} style={(state) => [...base, isHovered(state) && { borderColor: theme.borderStrong }, state.pressed && styles.pressed]}>{content}</Pressable>
  ) : (
    <View style={base}>{content}</View>
  );
}

/** Grille responsive : `columns` colonnes sur grand écran, 2 au plus sur écran moyen, 1 sur mobile. */
export function Grid({ columns, children, gap = 16 }: PropsWithChildren<{ columns: number; gap?: number }>) {
  const { desktop, large } = useAdminLayout();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const perRow = !desktop ? 1 : large ? columns : Math.min(columns, 2);
  const rows: ReactNode[][] = [];
  for (let index = 0; index < items.length; index += perRow) rows.push(items.slice(index, index + perRow));
  return (
    <View style={{ gap }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.gridRow, { gap }]}>
          {row.map((child, index) => <View key={index} style={styles.gridCell}>{child}</View>)}
          {Array.from({ length: perRow - row.length }, (_, index) => <View key={`filler-${index}`} style={styles.gridCell} />)}
        </View>
      ))}
    </View>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

export function SearchInput({ value, onChangeText, placeholder, style }: { value: string; onChangeText: (value: string) => void; placeholder: string; style?: StyleProp<ViewStyle> }) {
  const theme = useAdminTheme();
  return (
    <View style={[styles.inputBox, styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.borderStrong }, style]}>
      <MaterialIcons name="search" size={18} color={theme.textMuted} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.textMuted} accessibilityLabel={placeholder} style={[styles.input, { color: theme.text }]} />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => onChangeText("")}><MaterialIcons name="close" size={16} color={theme.textMuted} /></Pressable> : null}
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, hint, error, keyboardType = "default", multiline = false, secure = false, autoComplete, editable = true, style }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; hint?: string; error?: string | null; keyboardType?: "default" | "phone-pad" | "numeric" | "email-address"; multiline?: boolean; secure?: boolean; autoComplete?: "name" | "email" | "current-password" | "new-password"; editable?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useAdminTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        secureTextEntry={secure}
        autoComplete={autoComplete}
        autoCapitalize={secure || keyboardType === "email-address" ? "none" : undefined}
        editable={editable}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.inputBox,
          styles.input,
          multiline && styles.inputMultiline,
          { color: editable ? theme.text : theme.textMuted, backgroundColor: editable ? theme.surface : theme.surfaceMuted, borderColor: error ? theme.danger : focused ? theme.brand : theme.borderStrong },
        ]}
      />
      {error ? <Text style={[styles.hint, { color: theme.danger }]}>{error}</Text> : hint ? <Text style={[styles.hint, { color: theme.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function FieldLabel({ children }: PropsWithChildren) {
  const theme = useAdminTheme();
  return <Text style={[styles.label, { color: theme.textSecondary }]}>{children}</Text>;
}

export function Hint({ children, tone }: PropsWithChildren<{ tone?: Tone }>) {
  const theme = useAdminTheme();
  return <Text style={[styles.hint, { color: tone ? toneColors(theme, tone).fg : theme.textMuted }]}>{children}</Text>;
}

export type Option = { value: string; label: string };

/** Liste déroulante : un champ qui ouvre la liste des options. */
export function Select({ label, value, options, onChange, style, placeholder }: { label: string; value: string; options: readonly Option[]; onChange: (value: string) => void; style?: StyleProp<ViewStyle>; placeholder?: string }) {
  const theme = useAdminTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${current?.label ?? "non renseigné"}`}
        style={(state) => [styles.inputBox, styles.select, { backgroundColor: isHovered(state) ? theme.surfaceMuted : theme.surface, borderColor: theme.borderStrong }, style]}
        onPress={() => setOpen(true)}
      >
        <Text numberOfLines={1} style={[styles.selectText, { color: current ? theme.text : theme.textMuted }]}>{current?.label ?? placeholder ?? label}</Text>
        <MaterialIcons name="unfold-more" size={18} color={theme.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Fermer la liste" style={[styles.overlay, { backgroundColor: theme.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[styles.popover, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]} onPress={() => undefined}>
            <Text style={[styles.popoverTitle, { color: theme.textMuted }]}>{label}</Text>
            <ScrollView style={styles.popoverList}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={(state) => [styles.popoverOption, (active || isHovered(state)) && { backgroundColor: active ? theme.brandSoft : theme.surfaceMuted }]}
                    onPress={() => { onChange(option.value); setOpen(false); }}
                  >
                    <Text style={[styles.popoverOptionText, { color: active ? theme.brandText : theme.text }]}>{option.label}</Text>
                    {active ? <MaterialIcons name="check" size={18} color={theme.brandText} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Liste déroulante de formulaire, avec son libellé au-dessus (comme Field). */
export function SelectField({ label, style, ...props }: { label: string; value: string; options: readonly Option[]; onChange: (value: string) => void; style?: StyleProp<ViewStyle>; placeholder?: string }) {
  return (
    <View style={[styles.field, style]}>
      <FieldLabel>{label}</FieldLabel>
      <Select label={label} {...props} />
    </View>
  );
}

export function Segmented({ value, onChange, options, style }: { value: string; onChange: (value: string) => void; options: readonly Option[]; style?: StyleProp<ViewStyle> }) {
  const theme = useAdminTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={(state) => [styles.segment, active ? [styles.segmentActive, { backgroundColor: theme.surface, shadowColor: theme.shadow }] : isHovered(state) && { backgroundColor: theme.surfaceHover }]}
          >
            <Text numberOfLines={1} style={[styles.segmentText, { color: active ? theme.text : theme.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  const theme = useAdminTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={(state) => [styles.chip, { borderColor: selected ? theme.brand : theme.borderStrong, backgroundColor: selected ? theme.brandSoft : isHovered(state) ? theme.surfaceMuted : theme.surface }]}
    >
      {selected ? <MaterialIcons name="check" size={14} color={theme.brandText} /> : icon ? <MaterialIcons name={icon} size={14} color={theme.textMuted} /> : null}
      <Text style={[styles.chipText, { color: selected ? theme.brandText : theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Barre d'outils d'un tableau : recherche et filtres sur une ligne (retour à la ligne si besoin).
 * Sur mobile, seul le premier élément (la recherche) reste visible ; les filtres se déplient.
 */
export function Toolbar({ children }: PropsWithChildren) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const [open, setOpen] = useState(false);
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (desktop || items.length <= 1) return <View style={[styles.toolbar, desktop && styles.toolbarDesktop, { borderBottomColor: theme.border }]}>{items}</View>;
  return (
    <View style={[styles.toolbar, { borderBottomColor: theme.border }]}>
      <View style={styles.toolbarMobileTop}>
        <View style={styles.flex}>{items[0]}</View>
        <Button label="Filtres" icon={open ? "expand-less" : "tune"} onPress={() => setOpen((current) => !current)} />
      </View>
      {open ? items.slice(1) : null}
    </View>
  );
}

// ─── Tableaux ───────────────────────────────────────────────────────────────

export type Column = { key: string; label: string; flex?: number; width?: number; align?: "left" | "right" | "center" };

function columnStyle(column: Column): ViewStyle {
  return {
    ...(column.width ? { width: column.width, flexShrink: 0 } : { flex: column.flex ?? 1, minWidth: 0 }),
    alignItems: column.align === "right" ? "flex-end" : column.align === "center" ? "center" : "flex-start",
  };
}

/** Tableau de données : en-tête, lignes survolables, colonnes alignées. Défile horizontalement sous `minWidth`. */
export function DataTable<T>({ columns, rows, rowKey, renderCell, onRowPress, selectedKey, minWidth = 720 }: { columns: readonly Column[]; rows: readonly T[]; rowKey: (row: T) => string; renderCell: (row: T, key: string) => ReactNode; onRowPress?: (row: T) => void; selectedKey?: string | null; minWidth?: number }) {
  const theme = useAdminTheme();
  const [available, setAvailable] = useState(0);
  const width = available ? Math.max(available, minWidth) : undefined;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll} onLayout={(event) => setAvailable(Math.floor(event.nativeEvent.layout.width))}>
      <View style={{ width, minWidth }}>
        <View style={[styles.tr, styles.thead, { backgroundColor: theme.surfaceMuted, borderBottomColor: theme.border }]}>
          {columns.map((column) => (
            <View key={column.key} style={[styles.cell, columnStyle(column)]}>
              <Text numberOfLines={1} style={[styles.th, { color: theme.textMuted }]}>{column.label}</Text>
            </View>
          ))}
        </View>
        {rows.map((row, index) => {
          const key = rowKey(row);
          const cells = columns.map((column) => <View key={column.key} style={[styles.cell, columnStyle(column)]}>{renderCell(row, column.key)}</View>);
          const base = [styles.tr, styles.trBody, index < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }, key === selectedKey && { backgroundColor: theme.brandSoft }];
          return onRowPress ? (
            <Pressable key={key} accessibilityRole="button" onPress={() => onRowPress(row)} style={(state) => [...base, isHovered(state) && key !== selectedKey && { backgroundColor: theme.surfaceHover }]}>{cells}</Pressable>
          ) : (
            <View key={key} style={base}>{cells}</View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function CellText({ children, strong = false, muted = false, small = false, mono = false }: PropsWithChildren<{ strong?: boolean; muted?: boolean; small?: boolean; mono?: boolean }>) {
  const theme = useAdminTheme();
  return <Text numberOfLines={1} style={[styles.td, strong && styles.tdStrong, small && styles.tdSmall, mono && styles.mono, { color: muted ? theme.textMuted : strong ? theme.text : theme.textSecondary }]}>{children}</Text>;
}

export function CellStack({ title, subtitle, leading }: { title: string; subtitle?: string | null; leading?: ReactNode }) {
  return (
    <View style={styles.cellStackRow}>
      {leading}
      <View style={styles.cellStack}>
        <CellText strong>{title}</CellText>
        {subtitle ? <CellText muted small>{subtitle}</CellText> : null}
      </View>
    </View>
  );
}

function pageWindow(page: number, pages: number) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const result: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) result.push("…");
  for (let value = start; value <= end; value += 1) result.push(value);
  if (end < pages - 1) result.push("…");
  result.push(pages);
  return result;
}

/** Pied de tableau : nombre de résultats et pagination numérotée. */
export function Pagination({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (page: number) => void }) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  const pageButton = (value: number) => {
    const active = value === page;
    return (
      <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Page ${value}`} accessibilityState={{ selected: active }} onPress={() => onChange(value)} style={(state) => [styles.pageButton, { borderColor: active ? theme.brand : "transparent", backgroundColor: active ? theme.brandSoft : isHovered(state) ? theme.surfaceMuted : "transparent" }]}>
        <Text style={[styles.pageButtonText, { color: active ? theme.brandText : theme.textSecondary }]}>{value}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.pagination}>
      <Text style={[styles.paginationText, { color: theme.textMuted }]}>{total ? `${from.toLocaleString("fr-FR")}–${to.toLocaleString("fr-FR")} sur ${total.toLocaleString("fr-FR")}` : "Aucun résultat"}</Text>
      {pages > 1 ? (
        <View style={styles.paginationButtons}>
          <Button label="Précédent" icon="chevron-left" size="sm" disabled={page <= 1} onPress={() => onChange(page - 1)} />
          {desktop ? pageWindow(page, pages).map((value, index) => (value === "…" ? <Text key={`gap-${index}`} style={[styles.pageGap, { color: theme.textMuted }]}>…</Text> : pageButton(value))) : <Text style={[styles.paginationText, { color: theme.textSecondary }]}>{page} / {pages}</Text>}
          <Button label="Suivant" size="sm" disabled={page >= pages} onPress={() => onChange(page + 1)} />
        </View>
      ) : null}
    </View>
  );
}

// ─── États ──────────────────────────────────────────────────────────────────

export function EmptyState({ icon = "inbox", title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const theme = useAdminTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}><MaterialIcons name={icon} size={24} color={theme.textMuted} /></View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {message ? <Text style={[styles.emptyText, { color: theme.textMuted }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

/** Chargement, erreur ou contenu vide d'une zone de données. */
export function DataState({ loading, error, onRetry, empty, emptyTitle = "Aucune donnée", emptyMessage, children }: PropsWithChildren<{ loading?: boolean; error?: { message?: string } | null; onRetry?: () => void; empty?: boolean; emptyTitle?: string; emptyMessage?: string }>) {
  const theme = useAdminTheme();
  if (loading) {
    return (
      <View style={styles.empty} accessibilityLabel="Chargement des données administratives">
        <ActivityIndicator size="large" color={theme.brand} />
        <Text style={[styles.emptyText, { color: theme.textMuted }]}>Chargement…</Text>
      </View>
    );
  }
  if (error) return <EmptyState icon="error-outline" title="Impossible de charger les données" message={error.message} action={onRetry ? <Button label="Réessayer" icon="refresh" onPress={onRetry} /> : undefined} />;
  if (empty) return <EmptyState title={emptyTitle} message={emptyMessage} />;
  return <>{children}</>;
}

// ─── Fenêtres ───────────────────────────────────────────────────────────────

/** Fenêtre de dialogue : centrée sur bureau, plein écran sur mobile. */
export function Dialog({ visible, title, description, onClose, children, footer, width = 560 }: PropsWithChildren<{ visible: boolean; title: string; description?: string; onClose: () => void; footer?: ReactNode; width?: number }>) {
  const theme = useAdminTheme();
  const { desktop } = useAdminLayout();
  const body = (
    <>
      <View style={[styles.dialogHeader, { borderBottomColor: theme.border }]}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={[styles.dialogTitle, { color: theme.text }]}>{title}</Text>
          {description ? <Text style={[styles.cardDescription, { color: theme.textMuted }]}>{description}</Text> : null}
        </View>
        <IconButton icon="close" label="Fermer" onPress={onClose} />
      </View>
      <ScrollView style={styles.flexShrink} contentContainerStyle={styles.dialogBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? <View style={[styles.dialogFooter, { borderTopColor: theme.border, backgroundColor: theme.surfaceMuted }]}>{footer}</View> : null}
    </>
  );
  if (!desktop) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>{body}</View>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View style={[styles.dialog, { maxWidth: width, backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}>{body}</View>
      </View>
    </Modal>
  );
}

export function ConfirmDialog({ visible, title, message, confirmLabel, tone = "danger", loading, onConfirm, onClose }: { visible: boolean; title: string; message: string; confirmLabel: string; tone?: "danger" | "brand"; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  const theme = useAdminTheme();
  const { fg, bg } = toneColors(theme, tone);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View style={[styles.dialog, styles.confirm, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow }]}>
          <View style={[styles.confirmIcon, { backgroundColor: bg }]}><MaterialIcons name={tone === "danger" ? "warning-amber" : "help-outline"} size={22} color={fg} /></View>
          <Text style={[styles.dialogTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.confirmText, { color: theme.textMuted }]}>{message}</Text>
          <View style={styles.confirmActions}>
            <Button label="Annuler" onPress={onClose} disabled={loading} />
            <Button label={confirmLabel} variant={tone === "danger" ? "danger" : "primary"} loading={loading} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },

  button: { minHeight: 38, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  buttonSm: { minHeight: 32, paddingHorizontal: 10 },
  buttonShadow: { shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  buttonText: { fontSize: font.md, fontWeight: "600" },
  buttonTextSm: { fontSize: font.sm },
  iconButton: { borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, maxWidth: "100%" },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: font.xs, lineHeight: 18, fontWeight: "600" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700" },
  alert: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.lg, borderLeftWidth: 3 },
  alertBody: { flex: 1, gap: 2 },
  alertTitle: { fontSize: font.md, fontWeight: "600" },
  alertText: { fontSize: font.sm, lineHeight: 19 },

  pageHeader: { gap: 12 },
  pageHeaderDesktop: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 24 },
  pageTitle: { fontSize: font.xxl, lineHeight: 34, fontWeight: "700", letterSpacing: -0.3 },
  pageDescription: { fontSize: font.md, lineHeight: 21, marginTop: 4 },
  pageActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  card: { borderWidth: 1, borderRadius: radius.lg, shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  cardTitle: { fontSize: font.lg, lineHeight: 22, fontWeight: "600" },
  cardDescription: { fontSize: font.sm, lineHeight: 19, marginTop: 2 },
  cardActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  cardBody: { padding: 20, gap: 16 },
  cardFooter: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1 },

  kpiCard: { padding: 20, gap: 6 },
  kpiTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kpiLabel: { fontSize: font.sm, fontWeight: "500" },
  kpiIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 28, lineHeight: 36, fontWeight: "700", letterSpacing: -0.4 },
  kpiHint: { fontSize: font.xs },
  gridRow: { flexDirection: "row", alignItems: "stretch" },
  gridCell: { flex: 1, minWidth: 0 },

  field: { gap: 6 },
  label: { fontSize: font.sm, fontWeight: "600" },
  hint: { fontSize: font.xs, lineHeight: 17 },
  inputBox: { minHeight: 40, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: font.md, paddingVertical: 8 },
  inputMultiline: { minHeight: 84, textAlignVertical: "top" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8 },
  select: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" },
  selectText: { flex: 1, fontSize: font.md },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  popover: { width: "100%", maxWidth: 380, maxHeight: "70%", borderWidth: 1, borderRadius: radius.lg, padding: 8, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
  popoverTitle: { fontSize: font.xs, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 10, paddingVertical: 8 },
  popoverList: { flexGrow: 0 },
  popoverOption: { minHeight: 38, borderRadius: radius.md, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  popoverOptionText: { fontSize: font.md },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 2, alignSelf: "flex-start" },
  segment: { minHeight: 32, paddingHorizontal: 12, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  segmentActive: { shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: font.sm, fontWeight: "600" },
  chip: { minHeight: 30, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  chipText: { fontSize: font.sm, fontWeight: "500" },
  toolbar: { padding: 16, gap: 10, borderBottomWidth: 1 },
  toolbarMobileTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolbarDesktop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },

  tableScroll: { flexGrow: 0, width: "100%" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  thead: { minHeight: 42, borderBottomWidth: 1 },
  trBody: { minHeight: 56 },
  cell: { paddingHorizontal: 8, paddingVertical: 10, justifyContent: "center" },
  th: { fontSize: font.xs, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: font.sm, lineHeight: 20 },
  tdStrong: { fontWeight: "600" },
  tdSmall: { fontSize: font.xs, lineHeight: 17 },
  mono: { fontVariant: ["tabular-nums"] },
  cellStackRow: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "100%" },
  cellStack: { flex: 1, minWidth: 0 },

  pagination: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  paginationText: { fontSize: font.sm },
  paginationButtons: { flexDirection: "row", alignItems: "center", gap: 4 },
  pageButton: { minWidth: 32, height: 32, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  pageButtonText: { fontSize: font.sm, fontWeight: "600" },
  pageGap: { paddingHorizontal: 4 },

  empty: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.lg, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: font.lg, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: font.sm, lineHeight: 20, textAlign: "center", maxWidth: 420 },

  sheet: { flex: 1 },
  dialog: { width: "100%", maxHeight: "92%", borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", shadowOpacity: 0.2, shadowRadius: 32, shadowOffset: { width: 0, height: 16 } },
  dialogHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: 1 },
  dialogTitle: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  dialogBody: { padding: 24, gap: 18 },
  dialogFooter: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1 },
  confirm: { maxWidth: 420, padding: 24, gap: 10 },
  confirmIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  confirmText: { fontSize: font.md, lineHeight: 21 },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
});
