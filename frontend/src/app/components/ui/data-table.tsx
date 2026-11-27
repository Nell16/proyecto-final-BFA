import * as React from "react";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "./button";
import { EmptyState } from "./empty-state";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "./pagination";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { cn } from "./utils";

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export type DataTableDensity = "standard" | "compact" | "comfortable";

export interface DataTableRowLinkRenderProps<T> {
  row: T;
  href: string;
  className: string;
  children: React.ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T, index: number) => string;
  loading?: boolean;
  skeletonRows?: number;
  error?: React.ReactNode | Error | string | null;
  onRetry?: () => void;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  pagination?: DataTablePagination;
  density?: DataTableDensity;
  onRowClick?: (row: T) => void;
  getRowHref?: (row: T) => string | undefined;
  renderRowLink?: (props: DataTableRowLinkRenderProps<T>) => React.ReactNode;
  primaryColumnId?: string;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

const DENSITY_ROW_CLASSES: Record<DataTableDensity, string> = {
  standard: "h-11",
  compact: "h-9",
  comfortable: "h-14",
};

const DENSITY_CELL_CLASSES: Record<DataTableDensity, string> = {
  standard: "px-4 py-2.5",
  compact: "px-3 py-1.5",
  comfortable: "px-4 py-3",
};

const DENSITY_HEAD_CLASSES: Record<DataTableDensity, string> = {
  standard: "h-10 px-4",
  compact: "h-9 px-3",
  comfortable: "h-10 px-4",
};

const SKELETON_WIDTH_CLASSES = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5"];

const PRIMARY_ROW_ACTION_CLASS =
  "inline-flex max-w-full cursor-pointer items-center rounded-sm text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

function isInteractiveRowTarget(
  target: EventTarget | null,
  rowElement: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"]',
  );
  return Boolean(interactive && rowElement.contains(interactive));
}

function buildPageRange(current: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(totalPages - 1, current + 1);

  if (left > 2) {
    pages.push("ellipsis");
  }

  for (let page = left; page <= right; page += 1) {
    pages.push(page);
  }

  if (right < totalPages - 1) {
    pages.push("ellipsis");
  }

  pages.push(totalPages);
  return pages;
}

function renderErrorMessage(
  error: React.ReactNode | Error | string | null | undefined,
): React.ReactNode {
  if (error instanceof Error) {
    return error.message || "Ocurrió un error al cargar los registros.";
  }
  return error;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  skeletonRows,
  error = null,
  onRetry,
  emptyState,
  toolbar,
  pagination,
  density = "standard",
  onRowClick,
  getRowHref,
  renderRowLink,
  primaryColumnId,
  rowClassName,
  className,
}: DataTableProps<T>) {
  const effectiveSkeletonRows =
    skeletonRows ?? Math.min(pagination?.pageSize ?? 5, 8);

  const effectivePrimaryColumnId =
    primaryColumnId && columns.some((column) => column.id === primaryColumnId)
      ? primaryColumnId
      : columns[0]?.id;

  const hasError = Boolean(error);
  const isEmpty = !loading && !hasError && rows.length === 0;

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.pageSize)))
    : 1;
  const currentPage = pagination
    ? Math.min(Math.max(1, pagination.page), totalPages)
    : 1;
  const rangeStart =
    pagination && pagination.total > 0
      ? (currentPage - 1) * pagination.pageSize + 1
      : 0;
  const rangeEnd = pagination
    ? Math.min(currentPage * pagination.pageSize, pagination.total)
    : 0;
  const pageItems = pagination ? buildPageRange(currentPage, totalPages) : [];

  return (
    <div
      data-slot="data-table"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {toolbar && (
        <div
          data-slot="data-table-toolbar"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"
        >
          {toolbar}
        </div>
      )}

      {hasError && !loading ? (
        <div className="p-6">
          <div
            role="alert"
            className="flex flex-col items-center justify-center rounded-lg border border-danger-border bg-danger-muted/60 p-6 text-center"
          >
            <AlertCircle
              aria-hidden="true"
              className="mb-2 size-6 text-danger-foreground"
            />
            <p className="text-sm font-medium text-danger-foreground">
              {renderErrorMessage(error)}
            </p>
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="mt-4"
              >
                Reintentar
              </Button>
            )}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="p-6">
          {emptyState ?? <EmptyState />}
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-muted/70 [&_tr]:border-b [&_tr]:border-border">
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "text-xs font-semibold text-muted-foreground",
                    DENSITY_HEAD_CLASSES[density],
                    column.headerClassName ?? column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading
              ? Array.from({ length: effectiveSkeletonRows }, (_, rowIndex) => (
                  <TableRow
                    key={`skeleton-row-${rowIndex}`}
                    aria-hidden="true"
                    className={cn(
                      "border-border hover:bg-transparent",
                      DENSITY_ROW_CLASSES[density],
                    )}
                  >
                    {columns.map((column, colIndex) => (
                      <TableCell
                        key={`${column.id}-skeleton-${rowIndex}`}
                        className={cn(
                          DENSITY_CELL_CLASSES[density],
                          column.className,
                        )}
                      >
                        <Skeleton
                          className={cn(
                            "h-4",
                            SKELETON_WIDTH_CLASSES[
                              (rowIndex + colIndex) % SKELETON_WIDTH_CLASSES.length
                            ],
                          )}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row, rowIndex) => {
                  const rowHref = getRowHref?.(row);

                  return (
                    <TableRow
                      key={getRowId(row, rowIndex)}
                      onClick={
                        onRowClick
                          ? (event) => {
                              if (
                                isInteractiveRowTarget(
                                  event.target,
                                  event.currentTarget,
                                )
                              ) {
                                return;
                              }
                              if (window.getSelection()?.toString()) {
                                return;
                              }
                              onRowClick(row);
                            }
                          : undefined
                      }
                      className={cn(
                        "border-border hover:bg-muted/40",
                        DENSITY_ROW_CLASSES[density],
                        onRowClick && "cursor-pointer",
                        rowClassName?.(row),
                      )}
                    >
                      {columns.map((column) => {
                        const cellContent = column.cell(row, rowIndex);
                        const isPrimaryColumn =
                          column.id === effectivePrimaryColumnId;

                        let renderedCell: React.ReactNode = cellContent;
                        if (isPrimaryColumn && rowHref) {
                          renderedCell = renderRowLink ? (
                            renderRowLink({
                              row,
                              href: rowHref,
                              className: PRIMARY_ROW_ACTION_CLASS,
                              children: cellContent,
                            })
                          ) : (
                            <a
                              href={rowHref}
                              className={PRIMARY_ROW_ACTION_CLASS}
                              onClick={
                                onRowClick
                                  ? (event) => {
                                      event.stopPropagation();
                                      onRowClick(row);
                                    }
                                  : undefined
                              }
                            >
                              {cellContent}
                            </a>
                          );
                        } else if (isPrimaryColumn && onRowClick) {
                          renderedCell = (
                            <button
                              type="button"
                              className={PRIMARY_ROW_ACTION_CLASS}
                              onClick={(event) => {
                                event.stopPropagation();
                                onRowClick(row);
                              }}
                            >
                              {cellContent}
                            </button>
                          );
                        }

                        return (
                          <TableCell
                            key={column.id}
                            className={cn(
                              "text-sm text-foreground",
                              DENSITY_CELL_CLASSES[density],
                              column.className,
                            )}
                          >
                            {renderedCell}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      )}

      {pagination && !hasError && (
        <div
          data-slot="data-table-footer"
          className="flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs text-muted-foreground tabular-nums">
            {pagination.total === 0
              ? "Sin registros"
              : `Mostrando ${rangeStart}–${rangeEnd} de ${pagination.total}`}
          </p>

          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || currentPage <= 1}
                    onClick={() => pagination.onPageChange(currentPage - 1)}
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Anterior</span>
                  </Button>
                </PaginationItem>

                {pageItems.map((item, index) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <Button
                        type="button"
                        variant={item === currentPage ? "default" : "ghost"}
                        size="sm"
                        disabled={loading}
                        aria-current={item === currentPage ? "page" : undefined}
                        onClick={() => pagination.onPageChange(item)}
                        className="min-w-8 px-2.5 tabular-nums"
                      >
                        {item}
                      </Button>
                    </PaginationItem>
                  ),
                )}

                <PaginationItem>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || currentPage >= totalPages}
                    onClick={() => pagination.onPageChange(currentPage + 1)}
                    aria-label="Página siguiente"
                  >
                    <span className="hidden sm:inline">Siguiente</span>
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
