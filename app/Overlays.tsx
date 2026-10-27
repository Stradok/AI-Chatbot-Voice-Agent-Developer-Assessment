"use client";
import { useEffect } from "react";

const ME = { name: "Amman", email: "khawajaamman@gmail.com", phone: "+923129815068", github: "https://github.com/Stradok" };

export function Modal({ kind, onClose }: { kind: "help" | "contact"; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        {kind === "help" ? (
          <>
            <h2>How to use it</h2>
            <ol>
              <li><b>Type.</b> Write a question in any language and press Send. Every answer shows the PlacidWay page it came from; click a source to open it.</li>
              <li><b>Talk.</b> Press 🎙 Voice, allow the microphone and speak. A live waveform shows your voice, then the assistant&apos;s. Press Stop to end.</li>
              <li><b>Get a quote.</b> Say or type that you want one. The chat shows a short form; by voice, the assistant asks for your name and email.</li>
            </ol>
            <p className="tag">It only answers from the 7 PlacidWay pages it was given, and says so when it doesn&apos;t know.</p>
          </>
        ) : (
          <>
            <h2>Built by {ME.name}</h2>
            <p className="tag">AI Automation Engineer assessment for PlacidWay. Get in touch:</p>
            <div className="contacts">
              <a href={`mailto:${ME.email}`}><span>Email</span>{ME.email}</a>
              <a href={`tel:${ME.phone}`}><span>Phone</span>{ME.phone}</a>
              <a href={`https://wa.me/${ME.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><span>WhatsApp</span>{ME.phone}</a>
              <a href={ME.github} target="_blank" rel="noreferrer"><span>GitHub</span>github.com/Stradok</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
