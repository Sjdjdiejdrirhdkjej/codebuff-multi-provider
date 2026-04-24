import React, { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";

export interface ChatInputProps {
  prompt: string;
  onSubmit: (text: string) => void;
}

interface InputHandle {
  value: string;
  focus?: () => void;
  blur?: () => void;
}

export function ChatInput({ prompt, onSubmit }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const inputRef = useRef<InputHandle | null>(null);

  const refocus = (): void => {
    inputRef.current?.focus?.();
  };

  // Re-assert focus on every keystroke so clicking outside the input never
  // permanently steals focus. (OpenTUI may .blur() the input on a click.)
  useKeyboard(() => {
    refocus();
  });

  // Also re-assert focus periodically as a safety net (cheap, ~10 fps).
  useEffect(() => {
    const id = setInterval(refocus, 100);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = (text: string): void => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setValue("");
    if (inputRef.current) inputRef.current.value = "";
    refocus();
  };

  return (
    <box flexDirection="row" border="single" padding={1} width="100%">
      <text fg="cyan">{prompt} </text>
      <input
        ref={inputRef as never}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        focused
        flexGrow={1}
      />
    </box>
  );
}
