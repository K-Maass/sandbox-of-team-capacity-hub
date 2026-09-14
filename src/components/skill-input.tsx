import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

function uniqueSkills(skills: string[]) {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SkillChips({
  skills,
  limit,
  className = "",
}: {
  skills: string[];
  limit?: number;
  className?: string;
}) {
  if (!skills.length) return null;
  const visible = limit ? skills.slice(0, limit) : skills;
  const remaining = Math.max(skills.length - visible.length, 0);

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {visible.map((skill) => (
        <span
          key={skill}
          className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
        >
          {skill}
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          +{remaining}
        </span>
      )}
    </div>
  );
}

export function SkillInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add a skill and press Enter",
}: {
  value: string[];
  onChange: (skills: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();

  const addSkill = (raw: string) => {
    const skill = raw.trim().replace(/\s+/g, " ");
    if (!skill) return;
    const exists = value.some((item) => item.toLowerCase() === skill.toLowerCase());
    if (!exists) onChange([...value, skill]);
    setDraft("");
  };

  const removeSkill = (skill: string) => {
    onChange(value.filter((item) => item !== skill));
  };

  const availableSuggestions = uniqueSkills(suggestions)
    .filter((skill) => !value.some((item) => item.toLowerCase() === skill.toLowerCase()))
    .filter((skill) => !draft || skill.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 6);

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
            >
              {skill}
              <button
                type="button"
                onClick={() => removeSkill(skill)}
                className="rounded-full text-muted-foreground transition hover:text-foreground"
                aria-label={`Remove ${skill}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addSkill(draft);
            }
          }}
          onBlur={() => addSkill(draft)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {availableSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Existing:</span>
          {availableSuggestions.map((skill) => (
            <button
              key={skill}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addSkill(skill)}
              className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              + {skill}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
