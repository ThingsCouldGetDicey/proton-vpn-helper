/** Pure permission decision. A saved rule never implies permission to route. */
export function helperMayRoute(consent:boolean, rulesEnabled:boolean):boolean {
  return consent===true && rulesEnabled===true;
}
