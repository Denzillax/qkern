export type CliIo = {
    cwd: string;
    env: Readonly<Record<string, string | undefined>>;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
};
export declare const USAGE: string;
/**
 * Fuehrt einen CLI-Aufruf aus und liefert den Exit-Code. `help`, `--help`,
 * `-h` und der leere Aufruf zeigen die Nutzung auf stdout (0); ein unbekannter
 * oder unvollstaendiger Befehl zeigt sie auf stderr (1). Jeder andere Fehler
 * nennt seinen Grund: bis 2.16 stand da nur "QKERN CLI command failed.",
 * auch bei `qkern --help` (gefunden nach der ersten Veroeffentlichung).
 */
export declare function run(args: string[], io: CliIo): Promise<number>;
