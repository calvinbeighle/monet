# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monet is an Agent Native OS - a fork of an open-source desktop Linux distribution where the traditional desktop shell and application layer are replaced with an agent-native UI. The system takes user intent, runs AI agents, dynamically generates the optimal UI pattern for the task, and executes actions across connected tools upon user approval.

Development and testing happen inside a VM running the forked OS.

## Architecture

The core concept: the system chooses the interface, not the user. Instead of a single chat UI, it dynamically renders one of four UI patterns based on the task:

- **Tinder (Batch Decisions)** - swipe approve/reject for bulk similar outputs
- **Figma Whiteboard (Exploration)** - canvas with nodes/connections for planning and creative work
- **iMessage (Conversation)** - chat threads with inline suggestions for communication tasks
- **Diff/Compare (Precision)** - side-by-side views for code, edits, and option selection

## v1 Focus Areas

- **Email** (Gmail/Outlook) - draft replies, follow-ups, outbound sequences
- **Code** (GitHub) - generate code, review PRs, fix bugs

## Style

- Never use em dashes. Use hyphens instead.
