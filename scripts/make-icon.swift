// Zeichnet icon.png (512 x 512) fuer MCPB und Plugin.
// Ein Kalenderblatt mit Wochenraster, ein Feld hervorgehoben als freier Termin.
// Bewusst kein Nachbau des Calendar.app-Symbols.
// Aufruf: swift scripts/make-icon.swift <out.png>
import AppKit

let size = 512
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"

let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(
  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("no context") }

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(
    srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func rounded(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
  CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

// Hintergrund: abgerundetes Quadrat mit Verlauf.
let bg = CGRect(x: 16, y: 16, width: 480, height: 480)
ctx.saveGState()
ctx.addPath(rounded(bg, 108))
ctx.clip()
let gradient = CGGradient(
  colorsSpace: space, colors: [color(0x1f6f8b), color(0x14465c)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 496), end: CGPoint(x: 0, y: 16), options: [])
ctx.restoreGState()

// Blatt.
let page = CGRect(x: 96, y: 92, width: 320, height: 316)
ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 18, color: color(0x000000, 0.25))
ctx.setFillColor(color(0xffffff))
ctx.addPath(rounded(page, 36))
ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)

// Kopfleiste.
ctx.saveGState()
ctx.addPath(rounded(page, 36))
ctx.clip()
ctx.setFillColor(color(0xf2a541))
ctx.fill(CGRect(x: page.minX, y: page.maxY - 76, width: page.width, height: 76))
ctx.restoreGState()

// Ringe.
ctx.setFillColor(color(0x14465c))
for x in [176.0, 336.0] {
  ctx.addPath(rounded(CGRect(x: x - 12, y: page.maxY - 30, width: 24, height: 58), 12))
  ctx.fillPath()
}

// Raster 4 x 3, ein Feld als freier Termin.
let cols = 4, rows = 3
let cell: CGFloat = 52, gap: CGFloat = 16
let gridWidth = CGFloat(cols) * cell + CGFloat(cols - 1) * gap
let originX = page.midX - gridWidth / 2
let originY: CGFloat = 124
for row in 0..<rows {
  for col in 0..<cols {
    let rect = CGRect(
      x: originX + CGFloat(col) * (cell + gap), y: originY + CGFloat(row) * (cell + gap),
      width: cell, height: cell)
    let free = row == 1 && col == 2
    ctx.setFillColor(free ? color(0x2bb673) : color(0xdfe7ec))
    ctx.addPath(rounded(rect, 12))
    ctx.fillPath()
    if free {
      ctx.setStrokeColor(color(0xffffff))
      ctx.setLineWidth(8)
      ctx.setLineCap(.round)
      ctx.setLineJoin(.round)
      ctx.move(to: CGPoint(x: rect.minX + 13, y: rect.midY + 1))
      ctx.addLine(to: CGPoint(x: rect.minX + 23, y: rect.minY + 15))
      ctx.addLine(to: CGPoint(x: rect.maxX - 12, y: rect.maxY - 14))
      ctx.strokePath()
    }
  }
}

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
