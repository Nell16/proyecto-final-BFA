import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlobFile, filenameFromDisposition } from "./download";

describe("download helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts filename from standard and RFC 5987 Content-Disposition headers", () => {
    expect(filenameFromDisposition('attachment; filename="bfa-backup-20261001.json"', "fallback.json")).toBe(
      "bfa-backup-20261001.json",
    );
    expect(filenameFromDisposition("attachment; filename=respaldo.json", "fallback.json")).toBe("respaldo.json");
    expect(
      filenameFromDisposition(
        "attachment; filename=\"fallback.json\"; filename*=UTF-8''reporte%20final.pdf",
        "fallback.json",
      ),
    ).toBe("reporte final.pdf");
    expect(filenameFromDisposition(undefined, "fallback.json")).toBe("fallback.json");
  });

  it("creates an object URL, clicks anchor with filename, and revokes blob URL even if click fails", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/abc-123");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const blob = new Blob(['{"ok":true}'], { type: "application/json" });
    downloadBlobFile("backup.json", blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/abc-123");

    clickSpy.mockImplementation(() => {
      throw new Error("DOM error");
    });
    expect(() => downloadBlobFile("backup.json", blob)).toThrow("DOM error");
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
