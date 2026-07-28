import styled from 'styled-components';

/**
 * A styled-components atom. It contains no JSX of its own, so discovery has to
 * recognise the tagged template — otherwise a styled-components codebase scans
 * to an empty gallery.
 */
export const StyledTag = styled.span`
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: #ede9fe;
  color: #5b21b6;
`;

/** The `styled(Component)` wrapping form, which has a different tag shape. */
export const StyledTagLink = styled(StyledTag)`
  cursor: pointer;
  text-decoration: underline;
`;
