import * as React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";
import { cn } from "./utils";

export interface PageHeaderBreadcrumb {
  label: string;
  to?: string;
  renderLink?: (item: { label: string; to: string }) => React.ReactNode;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: PageHeaderBreadcrumb[];
  renderBreadcrumbLink?: (item: { label: string; to: string }) => React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  renderBreadcrumbLink,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-3 border-b border-border pb-4",
        className,
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList className="text-xs sm:gap-2">
            {breadcrumbs.map((item, index) => {
              const isLast = index === breadcrumbs.length - 1;
              const linkRenderer = item.renderLink ?? renderBreadcrumbLink;

              let content: React.ReactNode;
              if (item.to && !isLast) {
                if (linkRenderer) {
                  const rendered = linkRenderer({ label: item.label, to: item.to });
                  content = React.isValidElement(rendered) ? (
                    <BreadcrumbLink asChild>{rendered}</BreadcrumbLink>
                  ) : (
                    rendered
                  );
                } else {
                  content = <BreadcrumbLink href={item.to}>{item.label}</BreadcrumbLink>;
                }
              } else {
                content = <BreadcrumbPage className="font-medium">{item.label}</BreadcrumbPage>;
              }

              return (
                <React.Fragment key={`${item.label}-${index}`}>
                  <BreadcrumbItem>{content}</BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
