import React, { useState } from "react";

export interface ChatInputProps {
  prompt: string;
  onSubmit: (text: string) => void;
}

export function ChatInput({ prompt, onSubmit }: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string): void => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setValue("");
  };

  return (
    <box flexDirection="row" border="single" padding={1}>
      <text fg="cyan">{prompt} </text>
      <input
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        focused
      />
    </box>
  );
}
