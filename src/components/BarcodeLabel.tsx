"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export interface LabelSize {
  id: string;
  label: string;
  w: number;
  h: number;
  barcodeHeight: number;
  namePt: number;
  codePt: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: "50x30", label: "50 × 30 mm", w: 50, h: 30, barcodeHeight: 34, namePt: 8, codePt: 8 },
  { id: "40x30", label: "40 × 30 mm", w: 40, h: 30, barcodeHeight: 34, namePt: 7.5, codePt: 7.5 },
  { id: "100x50", label: "100 × 50 mm", w: 100, h: 50, barcodeHeight: 56, namePt: 11, codePt: 10 },
];

/** One barcode label: Code128 of the SKU + product name + code text. */
export default function BarcodeLabel({
  code,
  name,
  priceText,
  size,
}: {
  code: string;
  name: string;
  priceText?: string;
  size: LabelSize;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    try {
      JsBarcode(el, code, {
        format: "CODE128",
        width: code.length > 20 ? 1 : 2,
        height: size.barcodeHeight,
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      // Mã không vẽ được thì tem vẫn hiện tên + mã dạng chữ bên dưới.
    }
  }, [code, size]);

  return (
    <div
      className="label-page"
      style={{
        width: `${size.w}mm`,
        height: `${size.h}mm`,
        padding: "1.5mm 2mm",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#ffffff",
        color: "#000000",
      }}
    >
      <svg ref={svgRef} style={{ width: "100%", flexShrink: 0 }} />
      <p
        style={{
          fontSize: `${size.namePt}pt`,
          lineHeight: 1.25,
          textAlign: "center",
          margin: "0.5mm 0 0",
          maxHeight: "2.5em",
          overflow: "hidden",
        }}
      >
        {name}
      </p>
      <p
        style={{
          fontSize: `${size.codePt}pt`,
          lineHeight: 1.2,
          textAlign: "center",
          margin: 0,
        }}
      >
        {code}
        {priceText ? ` · ${priceText}` : ""}
      </p>
    </div>
  );
}
