// Vite's ?raw import embeds the license in the deployed diagnostics page.
declare module '*.txt?raw' {
  const text: string;
  export default text;
}
