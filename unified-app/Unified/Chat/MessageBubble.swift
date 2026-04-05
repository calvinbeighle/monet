// MessageBubble.swift
// A single chat bubble rendered inside ChatPanelView.
// Handles alignment, color, and basic markdown rendering:
//   - **bold**, *italic*, `inline code`, and fenced code blocks (```...```).
// User messages sit on the right; assistant messages on the left.

import SwiftUI

// MARK: - Inline Markdown Segment

/// One parsed segment of inline markdown text within a paragraph.
private enum InlineSegment {
    case plain(String)
    case bold(String)
    case italic(String)
    case code(String)
}

// MARK: - Block

/// Top-level structural block of a message.
private enum MarkdownBlock {
    /// A fenced code block (``` ... ```).
    case codeBlock(language: String, body: String)
    /// A normal paragraph that may contain inline markdown.
    case paragraph([InlineSegment])
}

// MARK: - Markdown Parser

/// Parses a raw message string into a sequence of `MarkdownBlock` values.
/// This is intentionally minimal - it covers the most common patterns returned
/// by Claude without pulling in a heavy dependency.
private func parseMarkdown(_ raw: String) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    var remaining = raw[raw.startIndex...]

    while !remaining.isEmpty {
        // Detect fenced code blocks first (``` ... ```).
        if remaining.hasPrefix("```") {
            let afterFence = remaining.dropFirst(3)
            // Collect optional language tag on the opening line.
            let newlineIdx = afterFence.firstIndex(of: "\n") ?? afterFence.endIndex
            let language = String(afterFence[afterFence.startIndex..<newlineIdx])
            let afterLang = newlineIdx < afterFence.endIndex
                ? afterFence[afterFence.index(after: newlineIdx)...]
                : afterFence[afterFence.endIndex...]

            // Find the closing fence.
            if let closeRange = afterLang.range(of: "```") {
                let body = String(afterLang[afterLang.startIndex..<closeRange.lowerBound])
                blocks.append(.codeBlock(language: language, body: body))
                remaining = afterLang[closeRange.upperBound...]
                // Skip a trailing newline immediately after the closing fence.
                if remaining.first == "\n" {
                    remaining = remaining.dropFirst()
                }
            } else {
                // Unclosed fence - treat as a plain paragraph.
                blocks.append(.paragraph(parseInline(String(remaining))))
                remaining = remaining[remaining.endIndex...]
            }
            continue
        }

        // Collect characters up to the next potential fenced block start.
        var paragraphChars = ""
        while !remaining.isEmpty {
            if remaining.hasPrefix("```") { break }
            paragraphChars.append(remaining.removeFirst())
        }

        // Split on double newlines to create separate paragraph blocks.
        let paragraphs = paragraphChars.components(separatedBy: "\n\n")
        for paragraph in paragraphs {
            let trimmed = paragraph.trimmingCharacters(in: .newlines)
            if !trimmed.isEmpty {
                blocks.append(.paragraph(parseInline(trimmed)))
            }
        }
    }

    return blocks
}

/// Parses inline markdown (`**bold**`, `*italic*`, `` `code` ``) from a string.
private func parseInline(_ text: String) -> [InlineSegment] {
    var segments: [InlineSegment] = []
    var remaining = text[text.startIndex...]

    while !remaining.isEmpty {
        // Bold: **text**
        if remaining.hasPrefix("**"),
           let closeRange = remaining.dropFirst(2).range(of: "**") {
            let inner = String(remaining.dropFirst(2)[remaining.dropFirst(2).startIndex..<closeRange.lowerBound])
            segments.append(.bold(inner))
            remaining = remaining.dropFirst(2)[closeRange.upperBound...]
            continue
        }

        // Italic: *text* (but not **)
        if remaining.hasPrefix("*"), !remaining.hasPrefix("**"),
           let closeIdx = remaining.dropFirst(1).firstIndex(of: "*") {
            let inner = String(remaining.dropFirst(1)[remaining.dropFirst(1).startIndex..<closeIdx])
            segments.append(.italic(inner))
            remaining = remaining.dropFirst(1)[remaining.dropFirst(1).index(after: closeIdx)...]
            continue
        }

        // Inline code: `text`
        if remaining.hasPrefix("`"),
           let closeIdx = remaining.dropFirst(1).firstIndex(of: "`") {
            let inner = String(remaining.dropFirst(1)[remaining.dropFirst(1).startIndex..<closeIdx])
            segments.append(.code(inner))
            remaining = remaining.dropFirst(1)[remaining.dropFirst(1).index(after: closeIdx)...]
            continue
        }

        // Plain character.
        segments.append(.plain(String(remaining.removeFirst())))
    }

    // Merge consecutive plain segments for efficiency.
    return mergedPlains(segments)
}

/// Collapses adjacent `.plain` segments into a single segment.
private func mergedPlains(_ segments: [InlineSegment]) -> [InlineSegment] {
    var result: [InlineSegment] = []
    for segment in segments {
        if case .plain(let new) = segment,
           case .plain(let existing) = result.last {
            result[result.count - 1] = .plain(existing + new)
        } else {
            result.append(segment)
        }
    }
    return result
}

// MARK: - Inline Segment View

/// Renders a single inline markdown segment as a SwiftUI Text node.
private func inlineSegmentText(_ segment: InlineSegment) -> Text {
    switch segment {
    case .plain(let s):
        return Text(s)
    case .bold(let s):
        return Text(s).bold()
    case .italic(let s):
        return Text(s).italic()
    case .code(let s):
        return Text(s).font(.system(.body, design: .monospaced))
    }
}

// MARK: - Paragraph View

/// Concatenates inline segments into a single SwiftUI `Text` with mixed styling.
private struct ParagraphView: View {
    let segments: [InlineSegment]

    var body: some View {
        segments.reduce(Text("")) { combined, segment in
            combined + inlineSegmentText(segment)
        }
        .font(.system(size: 14))
        .foregroundStyle(.white)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Code Block View

/// Displays a fenced code block with dark background and monospace font.
private struct CodeBlockView: View {
    let language: String
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !language.isEmpty {
                Text(language)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code.trimmingCharacters(in: .newlines))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.9))
                    .padding(.horizontal, 10)
                    .padding(.bottom, 8)
                    .padding(.top, language.isEmpty ? 8 : 0)
            }
        }
        .background(Color(hex: "#1a1a1a"))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Message Bubble

/// A chat bubble for a single `ChatMessage`.
/// User messages appear right-aligned with a blue bubble.
/// Assistant messages appear left-aligned with a dark gray bubble.
struct MessageBubble: View {
    let message: ChatMessage

    /// True when the message is from the user.
    private var isUser: Bool { message.role == .user }

    /// Bubble background color.
    private var bubbleColor: Color {
        isUser ? Color(hex: "#2563EB") : Color(hex: "#2a2a2a")
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
                ForEach(Array(parseMarkdown(message.content).enumerated()), id: \.offset) { _, block in
                    blockView(for: block)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(bubbleColor)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
            // Cap bubble width at 80% of available space via the container.
            // The outer GeometryReader in ChatPanelView governs the true max.

            if !isUser { Spacer(minLength: 48) }
        }
    }

    /// Dispatches rendering for each markdown block type.
    @ViewBuilder
    private func blockView(for block: MarkdownBlock) -> some View {
        switch block {
        case .codeBlock(let language, let codeBody):
            CodeBlockView(language: language, code: codeBody)
        case .paragraph(let segments):
            ParagraphView(segments: segments)
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 12) {
        MessageBubble(message: ChatMessage(
            role: .user,
            content: "How do I **center** a div with *flexbox*?"
        ))
        MessageBubble(message: ChatMessage(
            role: .assistant,
            content: "Use `display: flex` on the parent:\n\n```css\n.parent {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n```\n\nThis centers the child both **horizontally** and *vertically*."
        ))
    }
    .padding()
    .background(Color(hex: "#111111"))
    .frame(width: 500)
}
