import React, { useRef, useState } from "react";

export interface ChatInputProps {
  prompt: string;
  onSubmit: (text: string) => void;
}

export function ChatInput({ prompt, onSubmit }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const inputRef = useRef<{ value: string } | null>(null);

  const handleSubmit = (text: string): void => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setValue("");
    if (inputRef.current) inputRef.current.value = "";
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
