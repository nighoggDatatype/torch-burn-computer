function InputNote(
    {note, style} :
    {note : string | null, style? : { color : string }}
) {
    return note !== null ? (
        <div className="bc-field-note" style={{ marginBottom: 10, paddingLeft: 118 }}>
            <span style={style}>
            {note}
            </span>
        </div>
        ) : <></>;
}
export default InputNote;